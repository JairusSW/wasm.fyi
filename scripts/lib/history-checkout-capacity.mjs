import{readFile}from'node:fs/promises';import{join}from'node:path';import{requireBuildCapacity}from'./build-capacity.mjs';
// Caller holds the existing host build lease around this operation.
export async function withHistoricalCheckoutCapacity({directory,engine,configuration,revision,env,operation},io={readFile,requireBuildCapacity}){
 if(env.WASMFYI_BUILD_GROWTH_BYTES_BY_ENGINE===undefined||!['v8','jsc','graalwasm'].includes(engine))return operation();
 let receipt;try{receipt=JSON.parse(await io.readFile(join(directory,engine+'-build.json'),'utf8'))}catch(error){if(error.code!=='ENOENT')throw Error('Invalid sealed SDK receipt before source checkout: '+error)}
 if(receipt){if(receipt.pin?.revision!==revision||receipt.runtime?.id!==configuration||!receipt.controllerSha256||!receipt.runtime.file_sha256)throw Error('Cached SDK source/backend binding differs before checkout');}
 else await io.requireBuildCapacity(directory,engine,env);
 return operation();
}
