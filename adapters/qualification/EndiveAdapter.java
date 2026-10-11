import run.endive.wasm.Parser;
import run.endive.compiler.MachineFactoryCompiler;
import run.endive.compiler.InterpreterFallback;
import run.endive.wasm.WasmModule;
import run.endive.wasm.types.ValType;
import run.endive.runtime.Instance;
import run.endive.runtime.HostFunction;
import run.endive.runtime.ImportValues;
import org.json.*;
import java.io.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;

// Protocol v1 adapter. Timers exclude input setup and exact scalar/memory oracles.
// JVM compilation, allocation and GC use production defaults, not a tier lock.
public final class EndiveAdapter {
  private static final Map<WasmModule, java.util.function.Function<Instance, run.endive.runtime.Machine>> factories=new IdentityHashMap<>();
  private static final Map<WasmModule,Object> nativeCode=new IdentityHashMap<>();
  private static boolean redline;
  private static Object sdkCall(Class<?> type,String method,Object receiver,Class<?>[] signature,Object... args){
    try{return type.getMethod(method,signature).invoke(receiver,args);}
    catch(java.lang.reflect.InvocationTargetException error){throw new IllegalStateException(error.getCause().toString(),error.getCause());}
    catch(ReflectiveOperationException error){throw new IllegalStateException("Redline SDK API unavailable: "+error,error);}
  }
  private static Class<?> sdkClass(String name){try{return Class.forName(name);}catch(ClassNotFoundException error){throw new IllegalStateException("Redline SDK missing: "+name,error);}}
  private static String nativeTriple(){
    String arch=System.getProperty("os.arch"),os=System.getProperty("os.name");
    require(arch.equals("aarch64")||arch.equals("amd64")||arch.equals("x86_64"),"unsupported: Redline architecture");
    require(os.startsWith("Mac")||os.startsWith("Linux"),"unsupported: Redline OS");
    return (arch.equals("aarch64")?"aarch64":"x86_64")+(os.startsWith("Mac")?"-apple-darwin":"-unknown-linux-gnu");
  }
  private static WasmModule compile(byte[] bytes){
    WasmModule module=Parser.parse(bytes);
    if(redline)nativeCode.put(module,sdkCall(sdkClass("run.endive.redline.experimental.compiler.internal.NativeCompiler"),"compile",null,new Class<?>[]{String.class,WasmModule.class},nativeTriple(),module));
    else if(!interpreter)factories.put(module,MachineFactoryCompiler.builder(module).withInterpreterFallback(InterpreterFallback.FAIL).compile());
    return module;
  }
  private static boolean interpreter;
  private JSONObject preparation;
  private byte[] bytes;
  private WasmModule preparedModule;
  private Instance retainedSteady;
  private static Instance instance(WasmModule module,JSONObject workload){
    Instance.Builder builder;
    if(redline){
      Object nativeBuilder=sdkCall(sdkClass("run.endive.redline.experimental.runner.jffi.JffiNativeMachineFactory"),"builder",null,new Class<?>[]{WasmModule.class},module);
      sdkCall(nativeBuilder.getClass(),"withPrecompiledCode",nativeBuilder,new Class<?>[]{sdkClass("run.endive.redline.experimental.api.NativeCode")},nativeCode.get(module));
      builder=(Instance.Builder)sdkCall(nativeBuilder.getClass(),"toInstanceBuilder",nativeBuilder,new Class<?>[]{});
    }else{builder=Instance.builder(module);if(!interpreter)builder.withMachineFactory(factories.get(module));}
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
  private record VectorCase(byte[] input,byte[] expected) {}
  private record Execution(long[] result,long elapsedNs) {}
  private List<VectorCase> preparedVectors=List.of();
  private void clearPrepared(){
    if(retainedSteady!=null)retainedSteady.close();
    retainedSteady=null;preparedModule=null;preparation=null;bytes=null;
    preparedVectors=List.of();factories.clear();nativeCode.clear();
  }
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
    JSONObject oracle=w.getJSONObject("oracle");require(Arrays.equals(result,values(oracle.getJSONArray("expected"))),"incorrect result: scalar oracle mismatch; got "+decimals(result)+" expected "+oracle.getJSONArray("expected"));
    JSONArray memory=oracle.optJSONArray("memory");if(memory!=null)for(int k=0;k<memory.length();k++){JSONObject check=memory.getJSONObject(k);byte[] expected=HexFormat.of().parseHex(check.getString("hex"));byte[] actual=i.memory().readBytes(Math.addExact(pointer(i,oracle,"output_pointer_export"),offset(check,"offset")),expected.length);require(Arrays.equals(actual,expected),"incorrect result: memory oracle mismatch");}
  }
  private JSONObject describe(){JSONObject description=new JSONObject("""
    {"runtime":"endive-jit","runtime_version":"3c6d9cbdc9e96671f2526604d95ecd4ecfaf374c","backend":"jvm-bytecode-compiler","embedding":"Endive JVM embedding",
     "abis":["core"],"features":["mvp"],"scenarios":["compile","instantiate","first-call","steady"],
     "capabilities":{"can_compile_separately":true,"can_instantiate_separately":true,"can_host_function_calls_v1":true},
     "effective_configuration":{"compile_policy":"Parser.parse validation plus eager MachineFactoryCompiler bytecode generation; generated factory reused for instantiation",
      "call_policy":"export lookup, integer marshalling and result allocation included; exact scalar and memory oracles outside timer",
      "reset_policy":"fresh instance for lifecycle and fresh_instance_per_sample; retained instance for stateless steady",
      "release_policy":"references dropped; JVM GC uncontrolled; no physical RSS reclamation claim",
      "tiering":"Wasm to JVM bytecode; interpreter fallback forbidden; JVM JIT and GC at production defaults"}}
    """).put("build","wasm-fyi Endive adapter v1").put("java_version",System.getProperty("java.runtime.version")).put("java_vm",System.getProperty("java.vm.name"));description.getJSONObject("effective_configuration").put("java_version",System.getProperty("java.runtime.version")).put("java_vm",System.getProperty("java.vm.name")).put("jvm_arguments",java.lang.management.ManagementFactory.getRuntimeMXBean().getInputArguments().toString());if(interpreter){description.put("runtime","endive-interpreter").put("backend","jvm-interpreter");description.getJSONObject("effective_configuration").put("compile_policy","Parser.parse validation; interpreter instantiation").put("tiering","Wasm interpreter; host JVM JIT at production defaults");}return description;}
  private JSONObject handle(JSONObject request)throws Exception{
    require(request.getInt("version")==1,"protocol version mismatch");
    switch(request.getString("method")){
      case "describe":{
        JSONObject description=describe().put("qualification_persistent_close",true);
        if(redline){description.put("runtime","endive-redline").put("backend","cranelift-native");description.getJSONObject("effective_configuration").put("compile_policy","Parser.parse validation plus eager Redline NativeCompiler code generation; native image reused for instantiation").put("tiering","Cranelift native code via JFFI; no interpreter fallback").put("target_triple",nativeTriple());}
        return new JSONObject().put("description",description);
      }
      case "close":clearPrepared();return new JSONObject();
      case "prepare":{
        JSONObject p=request.getJSONObject("prepare"),w=p.getJSONObject("workload"),oracle=w.getJSONObject("oracle");
        require(!w.getString("id").startsWith("features/relaxed-simd/"),"unsupported: upstream parser has no relaxed-SIMD opcodes");
        require(List.of("timing","memory","code").contains(p.getString("profile")),"unsupported: timing/memory only");
        require(!p.getString("profile").equals("code")||redline,"unsupported: direct native-code size API is available only for Redline");
        require(w.getString("abi").equals("core")&&List.of("exact_u64","exact_vectors").contains(oracle.getString("kind"))&&List.of("stateless","fresh_instance_per_sample").contains(w.getString("reset")),"unsupported: core scalar exact-oracle contract required");
        for(String key:List.of("command","density","checkpoint","continuation","process_snapshot","guest_density","snapshot_density"))require(!w.has(key)||w.isNull(key)||w.optString(key,"").isEmpty(),"unsupported: extended workload contract "+key);
        require(List.of("","identity-v1","assemblyscript-abort-v1","threads-defined-v1").contains(w.optString("host_profile","")),"unsupported: unknown host import profile");
        require(oracle.isNull("float")&&oracle.optString("expected_trap","").isEmpty(),"unsupported: extended oracle");
        values(w.getJSONArray("args"));values(oracle.getJSONArray("expected"));
        byte[] next=Files.readAllBytes(Path.of(p.getString("artifact")));
        require(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(next)).equals(p.getString("artifact_sha256")),"artifact digest mismatch");
        clearPrepared();bytes=next;preparation=p;
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
        int operations=r.getInt("operations"),samples=r.getInt("samples"),warmup=r.getInt("warmup");require(operations>0&&samples>0&&warmup>=0&&samples<=1000000-warmup,"invalid run sizes");
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
            JSONArray observations=new JSONArray();
            if(preparation.getString("profile").equals("code")){
              require(scenario.equals("compile")&&samples==1&&warmup==0,"unsupported: code size requires one compile pass");
              Object code=nativeCode.get(module);
              byte[] image=(byte[])sdkCall(code.getClass(),"image",code,new Class<?>[]{});
              observations.put(new JSONObject().put("metric","native.code_size").put("definition_version",1).put("unit","bytes").put("scope","compiled_module").put("collector","Endive Redline NativeCode.image").put("collector_version","3c6d9cbdc9e96671f2526604d95ecd4ecfaf374c").put("profile","code").put("quality","engine_reported").put("phase","compile").put("denominator","module").put("status","available").put("value",image.length));
            }
            out.put(new JSONObject().put("index",index).put("warmup",index<warmup).put("elapsed_ns",elapsed).put("operations",scenario.equals("steady")?operations:1).put("sample_type",scenario.equals("steady")&&operations>1?"batch_average":"individual_operation").put("verified",true).put("result",decimals(execution.result())).put("observations",observations));
          }finally{
            if(target!=null&&target!=retainedSteady)target.close();
            if(scenario.equals("compile")&&module!=null){factories.remove(module);nativeCode.remove(module);}
          }
        }
        return new JSONObject().put("samples",out);
      }
      default:throw new IllegalArgumentException("unsupported: unknown method");
    }
  }
  private static boolean nativeV128Unavailable(Throwable error){
    if(!redline)return false;
    for(Throwable cause=error;cause!=null;cause=cause.getCause()){
      if(cause.getClass().getName().equals("run.endive.wasm.WasmEngineException")&&cause.getMessage()!=null&&cause.getMessage().matches("Failed to compile function [0-9]+: Unsupported ValType for native: V128"))return true;
    }
    return false;
  }
  public static void main(String[] args)throws Exception{
    interpreter=Arrays.asList(args).contains("--interpreter");redline=Arrays.asList(args).contains("--redline");require(!(redline&&interpreter),"Choose one Endive backend");EndiveAdapter adapter=new EndiveAdapter();BufferedReader input=new BufferedReader(new InputStreamReader(System.in));String line;
    while((line=input.readLine())!=null){JSONObject request=new JSONObject(line),response=new JSONObject().put("version",1).put("id",request.get("id"));
      try{JSONObject result=adapter.handle(request);for(String key:result.keySet())response.put(key,result.get(key));response.put("status","ok");}
      catch(Exception|LinkageError e){String reason=e.getMessage()==null?e.toString():e.getMessage();response.put("status",nativeV128Unavailable(e)||reason.startsWith("unsupported:")||reason.startsWith("Unhandled opcode:")||reason.contains("exceeds the Java method size limits")||reason.contains("invalid memory limit: 5")?"unsupported":"error").put("reason",reason);}
      System.out.println(response);System.out.flush();
    }
  }
}
