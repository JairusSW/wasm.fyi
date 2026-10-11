import {mkdir,readFile,readdir,cp,writeFile,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {digest} from './wasmbench.mjs';
import {verifySDKSubmodules} from './sdk-submodules.mjs';

export async function packageWasm2cSIMDe({source,sdk,run}) {
 const modules=await readFile(join(source,'.gitmodules'),'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
 if(!/^\s*path\s*=\s*third_party\/simde\s*$/m.test(modules))return null;
 const submodules=await verifySDKSubmodules(source,['third_party/simde'],run);
 const pin=submodules.find(p=>p.path==='third_party/simde');
 if(!pin?.initialized)throw Error('Wasm2c SIMD dependency is not initialized');
 const directory=join(source,'third_party/simde');
 if((await run('git',['status','--porcelain','--untracked-files=no'],{cwd:directory})).output.trim())throw Error('Wasm2c SIMD dependency has modified source');
 const header=await readFile(join(directory,'simde/wasm/simd128.h'));
 await mkdir(join(sdk,'include'),{recursive:true});
 await cp(join(directory,'simde'),join(sdk,'include/simde'),{recursive:true});
 return {path:'third_party/simde',revision:pin.revision,headerSha256:digest(header),installed:'include/simde',submodules};
}
export async function buildCTranspilerSDK({source,sdk,target,engine,env,run}) {
 if(!['wasm2c','w2c2'].includes(engine))throw Error('Unknown C transpiler');
 await mkdir(join(sdk,'bin'),{recursive:true});
 let binary,flags,simde=null;
 if(engine==='wasm2c'){
  await run('git',['submodule','update','--init','--recursive','--depth','1'],{cwd:source});
  flags=['-DCMAKE_BUILD_TYPE=Release','-DBUILD_TESTS=OFF','-DBUILD_LIBWASM=OFF'];
  if(env.WASMFYI_WASM2C_BUILD_CC)flags.push('-DCMAKE_C_COMPILER='+env.WASMFYI_WASM2C_BUILD_CC);
  if(env.WASMFYI_WASM2C_BUILD_CXX)flags.push('-DCMAKE_CXX_COMPILER='+env.WASMFYI_WASM2C_BUILD_CXX);
  await run('cmake',['-S',source,'-B',target,...flags]);await run('cmake',['--build',target,'--target','wasm2c','-j','2']);
  binary=join(target,'wasm2c');await cp(binary,join(sdk,'bin/wasm2c'));
  await mkdir(join(sdk,'include'),{recursive:true});await mkdir(join(sdk,'share/wabt/wasm2c'),{recursive:true});
  for(const name of await readdir(join(source,'wasm2c')))if(name.startsWith('wasm-rt')&&/\.(?:h|c|inc)$/.test(name)){
   await cp(join(source,'wasm2c',name),join(sdk,name.endsWith('.h')?'include':'share/wabt/wasm2c',name));
  }
  simde=await packageWasm2cSIMDe({source,sdk,run});
 } else {
  flags=['-DCMAKE_BUILD_TYPE=Release','-DSHARED_LIB=OFF'];
  if(env.WASMFYI_W2C2_C_FLAGS){
   if(env.WASMFYI_W2C2_C_FLAGS!=='-Wno-error=sign-conversion')throw Error('Unsupported w2c2 SDK warning policy');
   const launcher=join(sdk,'w2c2-sdk-compiler-launcher.sh');
   await writeFile(launcher,'#!/bin/sh\nexec "$@" -Wno-error=sign-conversion\n');await chmod(launcher,0o755);
   flags.push('-UCMAKE_PROJECT_INCLUDE','-DCMAKE_C_COMPILER_LAUNCHER='+launcher);
  }
  await run('cmake',['-S',join(source,'w2c2'),'-B',target,...flags]);await run('cmake',['--build',target,'--target','w2c2','-j','2']);
  binary=join(target,'w2c2');await cp(binary,join(sdk,'bin/w2c2'));
  await cp(join(source,'w2c2/w2c2_base.h'),join(sdk,'w2c2_base.h'));
 }
 env['WASMBENCH_'+engine.toUpperCase()]=join(sdk,'bin',engine);env['WASMBENCH_'+engine.toUpperCase()+'_SDK']=sdk;
 return {source,sdk,engine,flags,...(simde?{simde}:{}),translator:env['WASMBENCH_'+engine.toUpperCase()],translatorSha256:digest(await readFile(binary))};
}
