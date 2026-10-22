import io.github.charlietap.chasm.embedding.*
import io.github.charlietap.chasm.config.ModuleConfig
import io.github.charlietap.chasm.embedding.dsl.*
import io.github.charlietap.chasm.embedding.memory.*
import io.github.charlietap.chasm.embedding.shapes.*
import io.github.charlietap.chasm.host.*
import io.github.charlietap.chasm.runtime.type.ExternalType
import io.github.charlietap.chasm.runtime.value.*
import io.github.charlietap.chasm.type.*
import org.json.*
import java.nio.file.*
import java.security.MessageDigest

private fun hex(s: String)=java.util.HexFormat.of().parseHex(s)
private fun unsigned(n: ExecutionValue): String=when(n){
 is NumberValue.I32->Integer.toUnsignedString(n.value)
 is NumberValue.I64->java.lang.Long.toUnsignedString(n.value)
 is NumberValue.F32->Integer.toUnsignedString(java.lang.Float.floatToRawIntBits(n.value))
 is NumberValue.F64->java.lang.Long.toUnsignedString(java.lang.Double.doubleToRawLongBits(n.value))
 else->error("unsupported: non-numeric exported result")
}
private class ChasmAdapter {
 var preparation: JSONObject?=null
 var bytes=byteArrayOf()
 var cachedModule: Module?=null
 var cachedStore: Store?=null
 var cachedInstance: Instance?=null
 fun runSample(request: JSONObject): JSONObject {
    val p=requireNotNull(preparation);val w=p.getJSONObject("workload");val phase=request.getString("scenario")
    require(request.getInt("warmup")==0){"zero warmup required"}
    var elapsed=0L
    val decodeStart=System.nanoTime()
    // Chasm's pinned allocator shares mutable MemoryType limits with Module;
    // memory.grow updates those limits. Its public Module API has no clone.
    // Decode a fresh module for destructive reset fixtures outside non-compile
    // clocks, so every fresh instance starts from the original memory limits.
    val freshModule=w.getString("reset")=="fresh_instance_per_sample"
    val config=ModuleConfig(decodeNameSection=true)
    val module=if(phase=="compile"||freshModule) module(bytes,config).expect("module decode failed") else cachedModule ?: module(bytes,config).expect("module decode failed").also{cachedModule=it}
    if(phase=="compile")elapsed=System.nanoTime()-decodeStart
    val reuse=phase=="steady"&&w.getString("reset")=="stateless"&&cachedInstance!=null
    val store=if(reuse)requireNotNull(cachedStore) else store()
    val imports=when(w.optString("host_profile","")){
     "identity-v1"->listOf(functionImport(store){moduleName="wasmbench";entityName="identity";type{params{i32()};results{i32()}};reference(HostFunction{parameters,results->val v=parameters.readI32(0);results.writeI32(0,v)})})
     "assemblyscript-abort-v1"->listOf(functionImport(store){moduleName="env";entityName="abort";type{params{i32();i32();i32();i32()}};reference(HostFunction{_,_->error("AssemblyScript abort")})})
     else->emptyList()
    }
    val instantiateStart=System.nanoTime()
    val instance=if(reuse)requireNotNull(cachedInstance) else instance(store,module,imports).expect("instantiation failed")
    if(phase=="instantiate")elapsed=System.nanoTime()-instantiateStart
    if(phase=="steady"&&w.getString("reset")=="stateless"){cachedStore=store;cachedInstance=instance}
    val info=moduleInfo(module)
    fun call(name: String,args: JSONArray=JSONArray(),timed: Boolean=false): List<ExecutionValue>{
     val type=(info.exports.first{it.name==name}.type as ExternalType.Function).functionType
     require(type.params.types.size==args.length()){"argument arity mismatch"}
     val values=type.params.types.mapIndexed{index,t->val v=java.lang.Long.parseUnsignedLong(args.getString(index));when((t as ValueType.Number).numberType){NumberType.I32->NumberValue.I32(v.toInt());NumberType.I64->NumberValue.I64(v);NumberType.F32->NumberValue.F32(java.lang.Float.intBitsToFloat(v.toInt()));NumberType.F64->NumberValue.F64(java.lang.Double.longBitsToDouble(v))}}
     val start=System.nanoTime();val result=invoke(store,instance,name,values).expect("invocation failed")
     if(timed)elapsed+=System.nanoTime()-start
     return result
    }
    fun pointer(obj: JSONObject,key: String): Int {val name=obj.optString(key,"");return if(name.isEmpty())0 else unsigned(call(name).single()).toULong().toInt()}
    val memory=instance.exports.map{it.value}.filterIsInstance<Memory>().firstOrNull()
    if(!reuse&&w.optString("initialize","").isNotEmpty())require(call(w.getString("initialize")).isEmpty()){"initializer result arity"}
    val input=w.optJSONObject("input")
    if(!reuse&&input!=null)writeBytes(store,requireNotNull(memory),pointer(input,"pointer_export")+input.getInt("offset"),hex(input.getString("hex"))).expect("input write failed")
    val oracle=w.getJSONObject("oracle");var result=emptyList<ExecutionValue>()
    if(oracle.getString("kind")=="exact_vectors"){
     val vectors=w.getJSONObject("vectors");val inPointer=if(vectors.optString("input_ptr_export","").isEmpty())vectors.getInt("input_offset") else pointer(vectors,"input_ptr_export")
     val outPointer=if(vectors.optString("output_ptr_export","").isEmpty())vectors.getInt("output_offset") else pointer(vectors,"output_ptr_export")
     val cases=vectors.getJSONArray("cases")
     for(index in 0 until cases.length()){
      val c=cases.getJSONObject(index);val n=c.getInt("len");val mod=vectors.optInt("mod",0)
      val data=ByteArray(n){i->if(mod>0)(i%mod).toByte() else 0}
      writeBytes(store,requireNotNull(memory),inPointer,data).expect("vector input write failed")
      call(w.getString("export"),JSONArray(listOf(inPointer.toString(),n.toString(),outPointer.toString())),phase in listOf("first-call","steady"))
      val expected=hex(c.getString("out"));val actual=readBytes(store,memory,ByteArray(expected.size),outPointer,expected.size).expect("vector read failed")
      require(actual.contentEquals(expected)){"vector memory oracle mismatch"}
     }
    }else{
     val operations=if(phase=="steady")request.getInt("operations") else 1
     repeat(operations){result=call(w.getString("export"),w.getJSONArray("args"),phase in listOf("first-call","steady"))}
     require(result.map(::unsigned)==(0 until oracle.getJSONArray("expected").length()).map{oracle.getJSONArray("expected").getString(it)}){"scalar oracle mismatch: actual="+result.map(::unsigned)+" expected="+oracle.getJSONArray("expected")}
     val checks=oracle.optJSONArray("memory")?:JSONArray();val base=pointer(oracle,"output_pointer_export")
     for(i in 0 until checks.length()){val check=checks.getJSONObject(i);val expected=hex(check.getString("hex"));val actual=readBytes(store,requireNotNull(memory),ByteArray(expected.size),base+check.getInt("offset"),expected.size).expect("memory oracle read failed");require(actual.contentEquals(expected)){"memory oracle mismatch"}}
    }
    // Oracle verification and input setup remain outside every phase timer.
    return JSONObject().put("index",0).put("warmup",false).put("verified",true).put("operations",if(phase=="steady")request.getInt("operations") else 1).put("sample_type",if(w.has("vectors"))"sequence_call_sum" else if(request.getInt("operations")==1)"individual_operation" else "batch_average").put("elapsed_ns",elapsed).put("result",JSONArray(result.map(::unsigned)))
 }

 fun handle(q: JSONObject): JSONObject {
  when(q.getString("method")){
   "describe"->return JSONObject().put("description",JSONObject().put("runtime","chasm").put("runtime_version","source-main-2.2.0-SNAPSHOT").put("build","wasm-fyi Chasm adapter v1; source source-main-2.2.0-SNAPSHOT; Java "+System.getProperty("java.runtime.version")).put("backend","jvm-interpreter").put("embedding","Chasm Kotlin JVM embedding").put("features",JSONArray(listOf("extended-name-section"))).put("abis",JSONArray(listOf("core"))).put("scenarios",JSONArray(listOf("compile","instantiate","first-call","steady"))).put("effective_configuration",JSONObject().put("purpose","phase-separated interpreter timings; module and stateless instance cached across sample groups").put("fresh_reset_policy","fresh decoded module for destructive fixtures; decode outside instantiate/first-call/steady clock; public Module has no clone; prevents mutable memory limits crossing instances")))
   "close"->{preparation=null;bytes=byteArrayOf();cachedModule=null;cachedStore=null;cachedInstance=null;System.gc();return JSONObject()}
   "prepare"->{
    val p=q.getJSONObject("prepare");val w=p.getJSONObject("workload")
    cachedModule=null;cachedStore=null;cachedInstance=null
    require(p.getString("profile") in listOf("timing","memory")&&w.getString("abi")=="core"){"unsupported: core timing qualification required"}
    require(w.getJSONObject("oracle").getString("kind") in listOf("exact_u64","exact_vectors")){"unsupported: extended oracle"}
    require(w.optString("host_profile","") in listOf("","identity-v1","assemblyscript-abort-v1","threads-defined-v1")){"unsupported: host profile "+w.optString("host_profile")}
    require(w.getString("reset") in listOf("stateless","fresh_instance_per_sample")){"unsupported: reset policy"}
    bytes=Files.readAllBytes(Path.of(p.getString("artifact")))
    require(java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes))==p.getString("artifact_sha256")){"artifact hash mismatch"}
    preparation=p;return JSONObject()
   }
   "run"->{
    val request=q.getJSONObject("run");val count=request.getInt("samples");val operations=request.getInt("operations");val phase=request.getString("scenario")
    require(count in 1..35&&operations in 1..1000000&&request.getInt("warmup")==0){"invalid bounded sample batch"}
    require(phase in listOf("compile","instantiate","first-call","steady")){"unsupported: scenario"}
    require(phase=="steady"||operations==1){"lifecycle requires one operation"}
    val w=requireNotNull(preparation).getJSONObject("workload")
    require(!(w.has("vectors")||w.getString("reset")=="fresh_instance_per_sample")||operations==1){"unsupported: reset/vector batch requires one operation"}
    val samples=JSONArray();repeat(count){index->samples.put(runSample(request).put("index",index))}
    return JSONObject().put("samples",samples)
   }
   else->error("unsupported: unknown protocol method")
  }
 }
}
fun main(){val adapter=ChasmAdapter();generateSequence(::readLine).forEach{line->val q=JSONObject(line);val response=JSONObject().put("version",1).put("id",q.get("id"));try{val result=adapter.handle(q);result.keySet().forEach{key->response.put(key,result.get(key))};response.put("status","ok")}catch(e: Exception){val reason=e.message?:e.toString();response.put("status",if(reason.startsWith("unsupported:")||reason.contains("UnsupportedSIMDModule")||reason.contains("UnsupportedThreadsModule")||reason.contains("UnsupportedMemory64Module"))"unsupported" else "error").put("reason",reason)};println(response)}}
