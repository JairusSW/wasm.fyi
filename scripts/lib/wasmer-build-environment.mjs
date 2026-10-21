export function wasmerBuildEnvironment(env,platform=process.platform){
 if(platform!=='linux'||!env.WASMFYI_WASMER_CC&&!env.WASMFYI_WASMER_CXX)return env;
 const cc=env.WASMFYI_WASMER_CC,cxx=env.WASMFYI_WASMER_CXX;
 for(const [name,path] of [['WASMFYI_WASMER_CC',cc],['WASMFYI_WASMER_CXX',cxx]])if(!path||!path.startsWith('/')||/[\s"'$`]/.test(path))throw Error('Unsafe '+name+' path');
 return {...env,CC:cc,CXX:cxx,HOST_CC:cc,HOST_CXX:cxx};
}
