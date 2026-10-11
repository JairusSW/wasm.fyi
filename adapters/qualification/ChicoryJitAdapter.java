import com.dylibso.chicory.wasm.Parser;
import com.dylibso.chicory.compiler.MachineFactoryCompiler;
import com.dylibso.chicory.compiler.InterpreterFallback;
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
public final class ChicoryJitAdapter {
  private static final Map<WasmModule, java.util.function.Function<Instance, com.dylibso.chicory.runtime.Machine>> factories=new IdentityHashMap<>();
  private static WasmModule compile(byte[] bytes){
    WasmModule module=Parser.parse(bytes);
    factories.put(module,MachineFactoryCompiler.builder(module).withInterpreterFallback(InterpreterFallback.FAIL).compile());
    return module;
  }
  private JSONObject preparation;
  private byte[] bytes;
  private WasmModule preparedModule;
  private Instance retainedSteady;
  private record VectorCase(byte[] input,byte[] expected) {}
  private record Execution(long[] result,long elapsedNs) {}
  private List<VectorCase> preparedVectors=List.of();
  private Execution execute(Instance target,JSONObject w,long[] args,int operations){
    long elapsed=0;long[] result=new long[0];
    if(w.getJSONObject("oracle").getString("kind").equals("exact_vectors")){
      JSONObject vectors=w.getJSONObject("vectors");
      int input=vectors.optString("input_ptr_export","").isEmpty()?vectors.getInt("input_offset"):pointer(target,vectors,"input_ptr_export");
      int output=vectors.optString("output_ptr_export","").isEmpty()?vectors.getInt("output_offset"):pointer(target,vectors,"output_ptr_export");
      for(int operation=0;operation<operations;operation++)for(VectorCase vector:preparedVectors){
        target.memory().write(input,vector.input());
        long start=System.nanoTime();call(target,w.getString("export"),new long[]{Integer.toUnsignedLong(input),vector.input().length,Integer.toUnsignedLong(output)});elapsed+=System.nanoTime()-start;
        require(Arrays.equals(target.memory().readBytes(output,vector.expected().length),vector.expected()),"incorrect result: vector memory oracle mismatch");
      }
    }else if(w.getJSONObject("oracle").optJSONArray("memory")==null){
      long start=System.nanoTime();for(int operation=0;operation<operations;operation++)result=call(target,w.getString("export"),args);elapsed=System.nanoTime()-start;
      verify(target,w,result);
    }else{
      for(int operation=0;operation<operations;operation++){
        long start=System.nanoTime();result=call(target,w.getString("export"),args);elapsed+=System.nanoTime()-start;verify(target,w,result);
      }
    }
    return new Execution(result,elapsed);
  }

  private static Instance instance(WasmModule module,JSONObject workload){
    var builder=Instance.builder(module).withMachineFactory(factories.get(module));
    if(workload.optString("host_profile","").equals("identity-v1")){
      var identity=new HostFunction("wasmbench","identity",List.of(ValType.I32),List.of(ValType.I32),(inst,args)->new long[]{Integer.toUnsignedLong((int)args[0])});
      builder.withImportValues(ImportValues.builder().addFunction(identity).build());
    }
    if(workload.optString("host_profile","").equals("assemblyscript-abort-v1")){
      var abort=new HostFunction("env","abort",List.of(ValType.I32,ValType.I32,ValType.I32,ValType.I32),List.of(),(inst,args)->{throw new IllegalStateException("AssemblyScript abort");});
      builder.withImportValues(ImportValues.builder().addFunction(abort).build());
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
    if(result==null&&type.returns().isEmpty())result=new long[0];
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
    {"runtime":"chicory-jit","runtime_version":"e2e2e4058f49fbffeffc5ea92c54b41534cb45d3","backend":"jvm-bytecode-compiler","embedding":"Chicory JVM embedding",
     "abis":["core"],"features":["mvp"],"scenarios":["compile","instantiate","first-call","steady"],
     "capabilities":{"can_compile_separately":true,"can_instantiate_separately":true,"can_host_function_calls_v1":true},
     "effective_configuration":{"compile_policy":"Parser.parse validation plus eager MachineFactoryCompiler bytecode generation; generated factory reused for instantiation",
      "call_policy":"export lookup, integer marshalling and result allocation included; exact scalar and memory oracles outside timer",
      "reset_policy":"fresh instance for lifecycle and fresh_instance_per_sample; retained instance for stateless steady",
      "release_policy":"references dropped; JVM GC uncontrolled; no physical RSS reclamation claim",
      "tiering":"Wasm to JVM bytecode; interpreter fallback forbidden; JVM JIT and GC at production defaults"}}
    """).put("build","wasm-fyi Chicory adapter v1").put("java_version",System.getProperty("java.runtime.version")).put("java_vm",System.getProperty("java.vm.name"));description.getJSONObject("effective_configuration").put("java_version",System.getProperty("java.runtime.version")).put("java_vm",System.getProperty("java.vm.name")).put("jvm_arguments",java.lang.management.ManagementFactory.getRuntimeMXBean().getInputArguments().toString());return description;}
  private JSONObject handle(JSONObject request)throws Exception{
    require(request.getInt("version")==1,"protocol version mismatch");
    switch(request.getString("method")){
      case "describe":return new JSONObject().put("description",describe());
      case "close":preparation=null;bytes=null;preparedModule=null;retainedSteady=null;preparedVectors=List.of();factories.clear();return new JSONObject();
      case "prepare":{
        JSONObject p=request.getJSONObject("prepare"),w=p.getJSONObject("workload"),oracle=w.getJSONObject("oracle");
        require(!w.getString("id").startsWith("features/relaxed-simd/"),"unsupported: upstream parser has no relaxed-SIMD opcodes");
        require(List.of("timing","memory").contains(p.getString("profile")),"unsupported: timing/memory only");
        require(w.getString("abi").equals("core")&&List.of("exact_u64","exact_vectors").contains(oracle.getString("kind"))&&List.of("stateless","fresh_instance_per_sample").contains(w.getString("reset")),"unsupported: core scalar exact-oracle contract required");
        for(String key:List.of("command","density","checkpoint","continuation","process_snapshot","guest_density","snapshot_density"))require(!w.has(key)||w.isNull(key)||w.optString(key,"").isEmpty(),"unsupported: extended workload contract "+key);
        require(List.of("","identity-v1","assemblyscript-abort-v1","threads-defined-v1").contains(w.optString("host_profile","")),"unsupported: unknown host import profile");
        require(oracle.isNull("float")&&oracle.optString("expected_trap","").isEmpty(),"unsupported: extended oracle");
        values(w.getJSONArray("args"));values(oracle.getJSONArray("expected"));
        byte[] next=Files.readAllBytes(Path.of(p.getString("artifact")));
        require(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(next)).equals(p.getString("artifact_sha256")),"artifact digest mismatch");
        bytes=next;preparation=p;preparedModule=null;retainedSteady=null;preparedVectors=List.of();factories.clear();
        if(oracle.getString("kind").equals("exact_vectors")){
          JSONObject vectors=w.getJSONObject("vectors");JSONArray cases=vectors.getJSONArray("cases");List<VectorCase> prepared=new ArrayList<>();int mod=vectors.optInt("mod",0);
          for(int index=0;index<cases.length();index++){JSONObject vector=cases.getJSONObject(index);byte[] input=new byte[vector.getInt("len")];for(int offset=0;offset<input.length;offset++)input[offset]=(byte)(mod>0?offset%mod:0);prepared.add(new VectorCase(input,HexFormat.of().parseHex(vector.getString("out"))));}
          preparedVectors=List.copyOf(prepared);
        }
        return new JSONObject();
      }
      case "run":{
        require(preparation!=null,"prepare required");JSONObject w=preparation.getJSONObject("workload"),r=request.getJSONObject("run");String scenario=r.getString("scenario");
        require(List.of("compile","instantiate","first-call","steady").contains(scenario),"unsupported: scenario not implemented");require(!r.optBoolean("phase_barriers",false),"unsupported: phase barriers not implemented");
        int operations=r.getInt("operations"),samples=r.getInt("samples"),warmup=r.getInt("warmup");require(operations>0&&samples>0&&warmup==0&&samples<=35,"invalid run sizes");
        require(scenario.equals("steady")||(operations==1&&warmup==0),"unsupported: lifecycle requires one operation and zero warmup");
        require(w.getString("reset").equals("stateless")||operations==1,"unsupported: fresh instance requires one operation");
        WasmModule shared=null;
        if(!scenario.equals("compile")){if(preparedModule==null)preparedModule=compile(bytes);shared=preparedModule;}
        Instance steady=null;
        if(scenario.equals("steady")&&w.getString("reset").equals("stateless")){if(retainedSteady==null){retainedSteady=instance(shared,w);initialize(retainedSteady,w);}steady=retainedSteady;}
        JSONArray out=new JSONArray();long[] args=values(w.getJSONArray("args"));
        for(int index=0;index<samples+warmup;index++){
          Instance target=steady;WasmModule module=shared;
          try{
            if(scenario.equals("first-call")||(scenario.equals("steady")&&target==null)){target=instance(shared,w);initialize(target,w);}
            long elapsed;Execution execution;
            if(scenario.equals("compile")){
              long start=System.nanoTime();module=compile(bytes);elapsed=System.nanoTime()-start;
              target=instance(module,w);initialize(target,w);execution=execute(target,w,args,1);
            }else if(scenario.equals("instantiate")){
              long start=System.nanoTime();target=instance(shared,w);elapsed=System.nanoTime()-start;
              initialize(target,w);execution=execute(target,w,args,1);
            }else{execution=execute(target,w,args,operations);elapsed=execution.elapsedNs();}
            require(elapsed>=0,"elapsed time overflow");
            out.put(new JSONObject().put("index",index).put("warmup",index<warmup).put("elapsed_ns",elapsed).put("operations",scenario.equals("steady")?operations:1).put("sample_type",scenario.equals("steady")&&operations>1?"batch_average":"individual_operation").put("verified",true).put("result",decimals(execution.result())).put("observations",new JSONArray()));
          }finally{
            if(scenario.equals("compile")&&module!=null){factories.remove(module);}
          }
        }
        return new JSONObject().put("samples",out);
      }
      default:throw new IllegalArgumentException("unsupported: unknown method");
    }
  }
  public static void main(String[] args)throws Exception{
    ChicoryJitAdapter adapter=new ChicoryJitAdapter();BufferedReader input=new BufferedReader(new InputStreamReader(System.in));String line;
    while((line=input.readLine())!=null){JSONObject request=new JSONObject(line),response=new JSONObject().put("version",1).put("id",request.get("id"));
      try{JSONObject result=adapter.handle(request);for(String key:result.keySet())response.put(key,result.get(key));response.put("status","ok");}
      catch(Exception e){String reason=e.getMessage()==null?e.toString():e.getMessage();response.put("status",reason.startsWith("unsupported:")||reason.startsWith("Unhandled opcode:")||reason.contains("exceeds the Java method size limits")||reason.contains("invalid memory limit: 5")?"unsupported":"error").put("reason",reason);}
      System.out.println(response);System.out.flush();
    }
  }
}
