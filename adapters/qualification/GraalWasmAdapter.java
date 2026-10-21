import org.graalvm.polyglot.*;
import org.graalvm.polyglot.io.ByteSequence;
import org.graalvm.wasm.*;
import org.graalvm.wasm.memory.*;
import org.graalvm.wasm.predefined.*;
import com.oracle.truffle.api.frame.VirtualFrame;
import org.json.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;

// Phase-separated decode/instantiate/invoke timers; exact oracles stay outside timers.
public final class GraalWasmAdapter {
  // Selected from this SDK's option descriptors during SDK setup, before captures.
  static final List<String> FEATURE_OPTIONS=List.of("Memory64","MultiMemory","WideArithmetic","Threads","ExtendedConstExpressions","SIMD","RelaxedSIMD","Exceptions","LegacyExceptions","TypedFunctionReferences","GC","TailCalls");
  static final Map<String,String> ENGINE_OPTIONS=Map.of("BackgroundCompilation","false","CompileImmediately","true","MultiTier","false");
  JSONObject preparation;byte[] bytes;
  Context context;WasmModule compiled;WasmInstance retained;WasmStore retainedStore;Value retainedExports;
  void clear(){if(context!=null)context.close();context=null;compiled=null;retained=null;retainedStore=null;retainedExports=null;preparation=null;bytes=null;}
  static final class HostModule extends BuiltinModule {
    final boolean abort;HostModule(boolean abort){this.abort=abort;}
    protected WasmModule createModule(WasmLanguage language,WasmContext context,String name){
      WasmModule module=WasmModule.createBuiltin(language,name);
      defineFunction(context,module,abort?"abort":"identity",abort?types(WasmType.I32_TYPE,WasmType.I32_TYPE,WasmType.I32_TYPE,WasmType.I32_TYPE):types(WasmType.I32_TYPE),abort?types():types(WasmType.I32_TYPE),new WasmBuiltinRootNode(language,module){
        public Object executeWithInstance(VirtualFrame frame,WasmInstance instance){if(abort)throw new IllegalStateException("AssemblyScript abort");return WasmArguments.getArgument(frame.getArguments(),0);}
        public String builtinNodeName(){return abort?"qualification.abort":"qualification.identity";}
      });return module;
    }
  }
  static Object parameter(int type,long n){return switch(type){case WasmType.I32_TYPE->(int)n;case WasmType.I64_TYPE->n;case WasmType.F32_TYPE->Float.intBitsToFloat((int)n);case WasmType.F64_TYPE->Double.longBitsToDouble(n);default->throw new IllegalArgumentException("unsupported: nonnumeric export signature");};}
  static String result(int type,Value n){return switch(type){case WasmType.I32_TYPE->Integer.toUnsignedString(n.asInt());case WasmType.I64_TYPE->Long.toUnsignedString(n.asLong());case WasmType.F32_TYPE->Integer.toUnsignedString(Float.floatToRawIntBits(n.asFloat()));case WasmType.F64_TYPE->Long.toUnsignedString(Double.doubleToRawLongBits(n.asDouble()));default->throw new IllegalArgumentException("unsupported: nonnumeric exported result");};}
  static JSONArray call(Value exports,WasmInstance instance,String name,JSONArray args){
    WasmFunction f=instance.module().exportedFunctions().get(name);if(f==null)throw new IllegalArgumentException("missing export: "+name);
    if(f.paramCount()!=args.length())throw new IllegalArgumentException("export argument count mismatch");
    Object[] values=new Object[args.length()];for(int i=0;i<values.length;i++)values[i]=parameter(f.paramTypeAt(i),Long.parseUnsignedLong(args.getString(i)));
    Value returned=exports.getMember(name).execute(values);JSONArray output=new JSONArray();for(int i=0;i<f.resultCount();i++)output.put(result(f.resultTypeAt(i),f.resultCount()==1?returned:returned.getArrayElement(i)));return output;
  }
  static long pointer(Value exports,WasmInstance instance,JSONObject o,String key){String name=o.optString(key,"");return name.isEmpty()?0:Long.parseUnsignedLong(call(exports,instance,name,new JSONArray()).getString(0));}
  void ensureContext(){if(context!=null)return;
    Context.Builder builder=Context.newBuilder("wasm").allowExperimentalOptions(true).allowCreateThread(true).option("wasm.EvalReturnsInstance","true").option("wasm.UseUnsafeMemory","true").option("wasm.AsyncParsingBinarySize",Integer.toString(Integer.MAX_VALUE));
      for(var option:ENGINE_OPTIONS.entrySet())builder.option("engine."+option.getKey(),option.getValue());
      for(String option:FEATURE_OPTIONS)builder.option("wasm."+option,"true");
    context=builder.build();context.initialize("wasm");
  }
  JSONObject runSample(JSONObject r)throws Exception{JSONObject w=preparation.getJSONObject("workload");String phase=r.getString("scenario");
          WasmContext wasm=WasmContext.get(null);boolean reuse=phase.equals("steady")&&w.getString("reset").equals("stateless")&&retained!=null;WasmStore store=reuse?retainedStore:new WasmStore(wasm,wasm.language());String profile=w.optString("host_profile","");
          // This embedding creates no worker threads and never registers a
          // blocking waiter. Nonblocking wait compares actual shared memory;
          // notification therefore has zero queued waiters to wake.
          wasm.setMemNotifyCallback(new org.graalvm.wasm.api.Executable(arguments->0));
          wasm.setMemWaitCallback(new org.graalvm.wasm.api.Executable(arguments->{
            WasmMemory shared=(WasmMemory)arguments[0];long address=((Number)arguments[1]).longValue(),expected=((Number)arguments[2]).longValue(),timeout=((Number)arguments[3]).longValue();boolean is64=(boolean)arguments[4];
            WasmMemoryLibrary library=WasmMemoryLibrary.getFactory().getUncached();
            boolean equal=is64?library.atomic_load_i64(shared,null,address)==expected:library.atomic_load_i32(shared,null,address)==(int)expected;
            if(!equal)return 1;
            if(timeout==0)return 2;
            throw new IllegalArgumentException("unsupported: blocking waits require a multithreaded host embedding");
          }));
          if(!reuse&&profile.equals("identity-v1")){HostModule host=new HostModule(false);store.register(host.createInstance(wasm.language(),store,"wasmbench"));}
          if(!reuse&&profile.equals("assemblyscript-abort-v1")){HostModule host=new HostModule(true);store.register(host.createInstance(wasm.language(),store,"env"));}
          long elapsed=0,start=System.nanoTime();
          WasmModule module=phase.equals("compile")?wasm.readModule("guest",bytes,null):(compiled==null?(compiled=wasm.readModule("guest",bytes,null)):compiled);
          if(phase.equals("compile"))elapsed=System.nanoTime()-start;
          start=System.nanoTime();WasmInstance instance=reuse?retained:store.readInstance(module);Value exports=reuse?retainedExports:context.asValue(instance).getMember("exports");
          if(phase.equals("instantiate"))elapsed=System.nanoTime()-start;
          if(phase.equals("steady")&&w.getString("reset").equals("stateless")){retained=instance;retainedStore=store;retainedExports=exports;}
          String init=w.optString("initialize","");if(!reuse&&!init.isEmpty())call(exports,instance,init,new JSONArray());
          WasmMemoryLibrary memory=WasmMemoryLibrary.getFactory().getUncached();JSONObject input=w.optJSONObject("input");
          if(!reuse&&input!=null){long offset=pointer(exports,instance,input,"pointer_export")+input.getLong("offset");byte[] data=HexFormat.of().parseHex(input.getString("hex"));memory.initialize(instance.memory(0),null,data,0,offset,data.length);}
          JSONObject oracle=w.getJSONObject("oracle");JSONArray returned=new JSONArray();
          if(oracle.getString("kind").equals("exact_vectors")){
            JSONObject v=w.getJSONObject("vectors");long in=v.optString("input_ptr_export","").isEmpty()?v.getLong("input_offset"):pointer(exports,instance,v,"input_ptr_export"),out=v.optString("output_ptr_export","").isEmpty()?v.getLong("output_offset"):pointer(exports,instance,v,"output_ptr_export");JSONArray cases=v.getJSONArray("cases");
            for(int k=0;k<cases.length();k++){JSONObject c=cases.getJSONObject(k);int n=c.getInt("len"),mod=v.optInt("mod",0);byte[] data=new byte[n];for(int j=0;j<n;j++)data[j]=(byte)(mod>0?j%mod:0);memory.initialize(instance.memory(0),null,data,0,in,data.length);long callStart=System.nanoTime();call(exports,instance,w.getString("export"),new JSONArray(List.of(Long.toUnsignedString(in),Integer.toString(n),Long.toUnsignedString(out))));if(phase.equals("first-call")||phase.equals("steady"))elapsed+=System.nanoTime()-callStart;byte[] expected=HexFormat.of().parseHex(c.getString("out")),actual=new byte[expected.length];memory.copyToBuffer(instance.memory(0),null,actual,out,0,actual.length);if(!Arrays.equals(actual,expected))throw new IllegalArgumentException("vector memory oracle mismatch");}
          }else{
            for(int op=0;op<(phase.equals("steady")?r.getInt("operations"):1);op++){long callStart=System.nanoTime();returned=call(exports,instance,w.getString("export"),w.getJSONArray("args"));if(phase.equals("first-call")||phase.equals("steady"))elapsed+=System.nanoTime()-callStart;}if(!returned.toString().equals(oracle.getJSONArray("expected").toString()))throw new IllegalArgumentException("scalar oracle mismatch: got "+returned+" want "+oracle.getJSONArray("expected"));
            long base=pointer(exports,instance,oracle,"output_pointer_export");JSONArray checks=oracle.optJSONArray("memory");if(checks!=null)for(int k=0;k<checks.length();k++){JSONObject check=checks.getJSONObject(k);byte[] expected=HexFormat.of().parseHex(check.getString("hex")),actual=new byte[expected.length];memory.copyToBuffer(instance.memory(0),null,actual,base+check.getLong("offset"),0,actual.length);if(!Arrays.equals(actual,expected))throw new IllegalArgumentException("memory oracle mismatch");}
          }
          if(instance!=retained)for(int i=0;i<module.memoryCount();i++){WasmMemory owned=instance.memory(i);if(!memory.freed(owned))memory.close(owned);}
          return new JSONObject().put("index",0).put("warmup",false).put("verified",true).put("operations",phase.equals("steady")?r.getInt("operations"):1).put("elapsed_ns",elapsed).put("result",returned).put("sample_type",w.has("vectors")?"sequence_call_sum":r.getInt("operations")==1?"individual_operation":"batch_average");
  }
  JSONObject handle(JSONObject request)throws Exception{
    switch(request.getString("method")){
    case "describe":return new JSONObject().put("description",new JSONObject().put("runtime","graalwasm").put("runtime_version","25.4.4.1.1").put("build","wasm-fyi GraalWasm adapter v1; source 25.4.4.1.1; Java "+System.getProperty("java.runtime.version")).put("backend","truffle-graal").put("embedding","GraalVM Polyglot/Wasm SDK").put("abis",new JSONArray(List.of("core"))).put("capabilities",new JSONObject().put("can_compile_separately",true).put("can_instantiate_separately",true).put("can_run_vectors",true)).put("scenarios",new JSONArray(List.of("compile","instantiate","first-call","steady"))).put("effective_configuration",new JSONObject().put("java_vm",System.getProperty("java.vm.name")).put("java_version",System.getProperty("java.runtime.version")).put("tiering",ENGINE_OPTIONS.isEmpty()?"build-default Truffle tiering; no guest warmup":"available engine controls select eager synchronous highest-tier Truffle compilation; no guest warmup").put("vector_policy","ordered sequence; input writes and exact output checks outside summed export-call timers; one operation per sequence; no phase-barrier support").put("purpose","compile: SDK binary decode/validation; instantiate: fresh store instance and linking; Truffle native tiering occurs during recorded calls; cached module and stateless steady instance")));
    case "close":clear();return new JSONObject();
    case "prepare":{
      JSONObject p=request.getJSONObject("prepare"),w=p.getJSONObject("workload");clear();if(!List.of("timing","memory").contains(p.getString("profile"))||!w.getString("abi").equals("core"))throw new IllegalArgumentException("unsupported: core timing qualification required");
      if(!List.of("exact_u64","exact_vectors").contains(w.getJSONObject("oracle").getString("kind")))throw new IllegalArgumentException("unsupported: extended oracle");
      if(!List.of("","identity-v1","assemblyscript-abort-v1","threads-defined-v1").contains(w.optString("host_profile","")))throw new IllegalArgumentException("unsupported: host profile "+w.optString("host_profile"));
      bytes=Files.readAllBytes(Path.of(p.getString("artifact")));if(!HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)).equals(p.getString("artifact_sha256")))throw new IllegalArgumentException("artifact hash mismatch");preparation=p;return new JSONObject();
    }
    case "run":{
      if(preparation==null)throw new IllegalArgumentException("prepare required");
      JSONObject r=request.getJSONObject("run"),w=preparation.getJSONObject("workload");int samples=r.getInt("samples"),operations=r.getInt("operations");String phase=r.getString("scenario");
      if(samples<1||samples>35||operations<1||operations>1000000||r.getInt("warmup")!=0)throw new IllegalArgumentException("invalid zero-warmup sample batch");
      if(!List.of("compile","instantiate","first-call","steady").contains(phase))throw new IllegalArgumentException("unsupported: scenario");
      if((!phase.equals("steady")||w.has("vectors")||w.getString("reset").equals("fresh_instance_per_sample"))&&operations!=1)throw new IllegalArgumentException("unsupported: lifecycle/vector/reset samples require one operation");
      ensureContext();context.enter();try{JSONArray out=new JSONArray();for(int index=0;index<samples;index++)out.put(runSample(r).put("index",index));return new JSONObject().put("samples",out);}finally{context.leave();}
    }
    default:throw new IllegalArgumentException("unsupported: method");
    }
  }
  public static void main(String[] args)throws Exception{GraalWasmAdapter a=new GraalWasmAdapter();try(var in=new java.io.BufferedReader(new java.io.InputStreamReader(System.in))){String line;while((line=in.readLine())!=null){JSONObject q=new JSONObject(line),response=new JSONObject().put("version",1).put("id",q.get("id"));try{JSONObject value=a.handle(q);for(String key:value.keySet())response.put(key,value.get(key));response.put("status","ok");}catch(AssertionError e){e.printStackTrace(System.err);response.put("status","error").put("reason","engine assertion: "+e.getClass().getName()+": "+String.valueOf(e.getMessage()));}catch(Exception e){String reason=e.getMessage()==null?e.toString():e.getMessage();response.put("status",reason.startsWith("unsupported:")?"unsupported":"error").put("reason",reason);}System.out.println(response);System.out.flush();}}}
}
