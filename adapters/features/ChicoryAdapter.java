import com.dylibso.chicory.wasm.Parser;
import com.dylibso.chicory.wasm.WasmModule;
import com.dylibso.chicory.wasm.types.ValType;
import com.dylibso.chicory.runtime.Instance;
import com.dylibso.chicory.runtime.HostFunction;
import com.dylibso.chicory.runtime.ImportValues;
import org.json.*;
import java.io.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;

// Protocol v1 adapter. Timers exclude input setup and exact scalar/memory oracles.
// JVM compilation, allocation and GC use production defaults, not a tier lock.
public final class ChicoryAdapter {
  private JSONObject preparation;
  private byte[] bytes;
  private static Instance instance(WasmModule module,JSONObject workload){
    var builder=Instance.builder(module);
    if(workload.optString("host_profile","").equals("identity-v1")){
      var identity=new HostFunction("wasmbench","identity",List.of(ValType.I32),List.of(ValType.I32),(inst,args)->new long[]{Integer.toUnsignedLong((int)args[0])});
      builder.withImportValues(ImportValues.builder().addFunction(identity).build());
    }
    return builder.build();
  }
  private static void require(boolean yes,String reason){if(!yes)throw new IllegalArgumentException(reason);}
  private static long[] values(JSONArray a){long[] out=new long[a.length()];for(int i=0;i<out.length;i++)out[i]=Long.parseUnsignedLong(a.getString(i));return out;}
  private static JSONArray decimals(long[] a){JSONArray out=new JSONArray();for(long v:a)out.put(Long.toUnsignedString(v));return out;}
  private static long[] call(Instance i,String name,long[] args){
    var type=i.exportType(name);
    require(type.params().size()==args.length,"argument count mismatch");
    require(type.params().stream().allMatch(t->t.equals(ValType.I32)||t.equals(ValType.I64)) && type.returns().stream().allMatch(t->t.equals(ValType.I32)||t.equals(ValType.I64)),"unsupported: i32/i64 signatures only");
    long[] result=i.export(name).apply(args);
    require(result.length==type.returns().size(),"result arity mismatch");
    for(int k=0;k<result.length;k++)if(type.returns().get(k).equals(ValType.I32))result[k]=Integer.toUnsignedLong((int)result[k]);
    return result;
  }
  private static int offset(JSONObject value,String key){long n=value.getLong(key);require(n>=0&&n<=Integer.MAX_VALUE,"unsupported: memory offset exceeds JVM adapter range");return (int)n;}
  private static int pointer(Instance i,JSONObject value,String key){String name=value.optString(key,"");if(name.isEmpty())return 0;long[] result=call(i,name,new long[0]);require(result.length==1&&result[0]>=0&&result[0]<=Integer.MAX_VALUE,"unsupported: pointer exceeds JVM adapter range");return (int)result[0];}
  private static void initialize(Instance i,JSONObject w){
    String name=w.optString("initialize","");if(!name.isEmpty())require(call(i,name,new long[0]).length==0,"initializer must return no values");
    JSONObject input=w.optJSONObject("input");if(input!=null){byte[] data=HexFormat.of().parseHex(input.getString("hex"));i.memory().write(Math.addExact(pointer(i,input,"pointer_export"),offset(input,"offset")),data);}
  }
  private static void verify(Instance i,JSONObject w,long[] result){
    JSONObject oracle=w.getJSONObject("oracle");require(Arrays.equals(result,values(oracle.getJSONArray("expected"))),"incorrect result: scalar oracle mismatch");
    JSONArray memory=oracle.optJSONArray("memory");if(memory!=null)for(int k=0;k<memory.length();k++){JSONObject check=memory.getJSONObject(k);byte[] expected=HexFormat.of().parseHex(check.getString("hex"));byte[] actual=i.memory().readBytes(Math.addExact(pointer(i,oracle,"output_pointer_export"),offset(check,"offset")),expected.length);require(Arrays.equals(actual,expected),"incorrect result: memory oracle mismatch");}
  }
  private JSONObject describe(){JSONObject description=new JSONObject("""
    {"runtime":"chicory","runtime_version":"1.7.5","backend":"interpreter","embedding":"Chicory JVM embedding",
     "abis":["core"],"features":["mvp"],"scenarios":["compile","instantiate","first-call","steady"],
     "capabilities":{"can_compile_separately":true,"can_instantiate_separately":true,"can_host_function_calls_v1":true},
     "effective_configuration":{"compile_policy":"Parser.parse validation; interpreter machine construction occurs during instantiation; not native code generation",
      "call_policy":"export lookup, integer marshalling and result allocation included; exact scalar and memory oracles outside timer",
      "reset_policy":"fresh instance for lifecycle and fresh_instance_per_sample; retained instance for stateless steady",
      "release_policy":"references dropped; JVM GC uncontrolled; no physical RSS reclamation claim",
      "tiering":"Wasm interpreter; JVM JIT and GC at production defaults"}}
    """).put("build","wasm-fyi Chicory adapter v1").put("java_version",System.getProperty("java.runtime.version")).put("java_vm",System.getProperty("java.vm.name"));description.getJSONObject("effective_configuration").put("java_version",System.getProperty("java.runtime.version")).put("java_vm",System.getProperty("java.vm.name")).put("jvm_arguments",java.lang.management.ManagementFactory.getRuntimeMXBean().getInputArguments().toString());return description;}
  private JSONObject handle(JSONObject request)throws Exception{
    require(request.getInt("version")==1,"protocol version mismatch");
    switch(request.getString("method")){
      case "describe":return new JSONObject().put("description",describe());
      case "close":preparation=null;bytes=null;return new JSONObject();
      case "prepare":{
        JSONObject p=request.getJSONObject("prepare"),w=p.getJSONObject("workload"),oracle=w.getJSONObject("oracle");
        require(List.of("timing","memory").contains(p.getString("profile")),"unsupported: timing/memory only");
        require(w.getString("abi").equals("core")&&oracle.getString("kind").equals("exact_u64")&&List.of("stateless","fresh_instance_per_sample").contains(w.getString("reset")),"unsupported: core scalar exact-oracle contract required");
        for(String key:List.of("command","vectors","density","checkpoint","continuation","process_snapshot","guest_density","snapshot_density"))require(!w.has(key)||w.isNull(key)||w.optString(key,"").isEmpty(),"unsupported: extended workload contract "+key);
        require(List.of("","identity-v1").contains(w.optString("host_profile","")),"unsupported: unknown host import profile");
        require(oracle.isNull("float")&&oracle.optString("expected_trap","").isEmpty(),"unsupported: extended oracle");
        values(w.getJSONArray("args"));values(oracle.getJSONArray("expected"));
        byte[] next=Files.readAllBytes(Path.of(p.getString("artifact")));
        require(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(next)).equals(p.getString("artifact_sha256")),"artifact digest mismatch");
        bytes=next;preparation=p;return new JSONObject();
      }
      case "run":{
        require(preparation!=null,"prepare required");JSONObject w=preparation.getJSONObject("workload"),r=request.getJSONObject("run");String scenario=r.getString("scenario");
        require(List.of("compile","instantiate","first-call","steady").contains(scenario),"unsupported: scenario not implemented");require(!r.optBoolean("phase_barriers",false),"unsupported: phase barriers not implemented");
        int operations=r.getInt("operations"),samples=r.getInt("samples"),warmup=r.getInt("warmup");require(operations>0&&samples>0&&warmup>=0&&samples<=1000000-warmup,"invalid run sizes");
        require(scenario.equals("steady")||(operations==1&&warmup==0),"unsupported: lifecycle requires one operation and zero warmup");
        require(w.getString("reset").equals("stateless")||operations==1,"unsupported: fresh instance requires one operation");
        WasmModule shared=scenario.equals("compile")?null:Parser.parse(bytes);Instance steady=null;
        if(scenario.equals("steady")&&w.getString("reset").equals("stateless")){steady=instance(shared,w);initialize(steady,w);verify(steady,w,call(steady,w.getString("export"),values(w.getJSONArray("args"))));}
        JSONArray out=new JSONArray();long[] args=values(w.getJSONArray("args"));
        for(int index=0;index<samples+warmup;index++){
          Instance target=steady;WasmModule module=shared;
          if(scenario.equals("first-call")||(scenario.equals("steady")&&target==null)){target=instance(shared,w);initialize(target,w);}
          List<long[]> results=new ArrayList<>();long start=System.nanoTime();
          if(scenario.equals("compile"))module=Parser.parse(bytes);
          else if(scenario.equals("instantiate"))target=instance(shared,w);
          else for(int op=0;op<operations;op++)results.add(call(target,w.getString("export"),args));
          long elapsed=System.nanoTime()-start;require(elapsed>=0,"elapsed time overflow");
          if(scenario.equals("compile"))target=instance(module,w);
          if(scenario.equals("compile")||scenario.equals("instantiate")){initialize(target,w);results.add(call(target,w.getString("export"),args));}
          for(long[] result:results)verify(target,w,result);
          out.put(new JSONObject().put("index",index).put("warmup",index<warmup).put("elapsed_ns",elapsed).put("operations",scenario.equals("steady")?operations:1).put("sample_type",scenario.equals("steady")&&operations>1?"batch_average":"individual_operation").put("verified",true).put("result",decimals(results.get(results.size()-1))).put("observations",new JSONArray()));
        }
        return new JSONObject().put("samples",out);
      }
      default:throw new IllegalArgumentException("unsupported: unknown method");
    }
  }
  public static void main(String[] args)throws Exception{
    ChicoryAdapter adapter=new ChicoryAdapter();BufferedReader input=new BufferedReader(new InputStreamReader(System.in));String line;
    while((line=input.readLine())!=null){JSONObject request=new JSONObject(line),response=new JSONObject().put("version",1).put("id",request.get("id"));
      try{JSONObject result=adapter.handle(request);for(String key:result.keySet())response.put(key,result.get(key));response.put("status","ok");}
      catch(Exception e){String reason=e.getMessage()==null?e.toString():e.getMessage();response.put("status",reason.startsWith("unsupported:")?"unsupported":"error").put("reason",reason);}
      System.out.println(response);System.out.flush();
    }
  }
}
