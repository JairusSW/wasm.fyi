export function spiderMonkeyCbindgenEnvironment(env,minimumRust,minimumCbindgen,platform=process.platform){
 if(platform!=='darwin'||minimumRust!=='1.90.0'||minimumCbindgen!=='0.29.4'||!env.WASMFYI_SPIDERMONKEY_CBINDGEN)return {...env};
 const tool=env.WASMFYI_SPIDERMONKEY_CBINDGEN;
 if(!tool.startsWith('/')||/[\s"'$`]/.test(tool))throw Error('Unsafe private SpiderMonkey cbindgen path');
 return {...env,CBINDGEN:tool};
}
