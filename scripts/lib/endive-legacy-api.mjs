export function withEndiveLegacyNativeAPI(source){
 const marker='  private static Object sdkCompileNative(WasmModule module){';
 if(source.includes(marker))return source;
 const compile='sdkCall(sdkClass("run.endive.redline.experimental.compiler.internal.NativeCompiler"),"compile",null,new Class<?>[]{String.class,WasmModule.class},nativeTriple(),module)';
 const type='new Class<?>[]{sdkClass("run.endive.redline.experimental.api.NativeCode")},nativeCode.get(module)';
 const image='byte[] image=(byte[])sdkCall(code.getClass(),"image",code,new Class<?>[]{});';
 for(const seam of [compile,type,image])if(source.split(seam).length!==2)throw Error('Endive native SDK API seam changed');
 const helpers=`  private static Object sdkCompileNative(WasmModule module){
    Class<?> compiler=sdkClass("run.endive.redline.experimental.compiler.internal.NativeCompiler");
    String method="compile";
    try{compiler.getMethod(method,String.class,WasmModule.class);}
    catch(NoSuchMethodException absent){
      method="compileAll";
      try{if(compiler.getMethod(method,String.class,WasmModule.class).getReturnType()!=byte[][].class)throw new IllegalStateException("Redline legacy compileAll return type changed");}
      catch(NoSuchMethodException missing){throw new IllegalStateException("Redline SDK API unavailable: neither compile nor compileAll",missing);}
    }
    return sdkCall(compiler,method,null,new Class<?>[]{String.class,WasmModule.class},nativeTriple(),module);
  }
  private static Class<?> sdkNativeCodeType(Object code){return code instanceof byte[][]?byte[][].class:sdkClass("run.endive.redline.experimental.api.NativeCode");}
  private static long sdkNativeCodeBytes(Object code){
    if(code instanceof byte[][]){long bytes=0;for(byte[] function:(byte[][])code)if(function!=null)bytes=Math.addExact(bytes,function.length);return bytes;}
    return ((byte[])sdkCall(code.getClass(),"image",code,new Class<?>[]{})).length;
  }
`;
 return source.replace('  private static WasmModule compile(byte[] bytes){',helpers+'  private static WasmModule compile(byte[] bytes){').replace(compile,'sdkCompileNative(module)').replace(type,'new Class<?>[]{sdkNativeCodeType(nativeCode.get(module))},nativeCode.get(module)').replace(image,'long nativeBytes=sdkNativeCodeBytes(code);').replace('.put("collector","Endive Redline NativeCode.image")','.put("collector",code instanceof byte[][]?"Endive Redline NativeCompiler.compileAll function code":"Endive Redline NativeCode.image")').replace('.put("value",image.length)','.put("value",nativeBytes)');
}
