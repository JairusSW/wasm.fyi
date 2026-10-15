import {mkdir,readFile,readdir,cp,writeFile,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {availableParallelism} from 'node:os';
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
// The SIMD fork's generated C needs transitive headers. Wait/notify also needs
// the three futex translation units compiled with the same flags as the guest.
export async function packageW2c2Runtime({source,sdk}) {
 const files=[];
 async function copyFile(relative,installed=relative.replace(/^w2c2\//,'')) {
  const bytes=await readFile(join(source,relative));
  await mkdir(join(sdk,installed,'..'),{recursive:true});
  await writeFile(join(sdk,installed),bytes);
  files.push({source:relative,installed,sha256:digest(bytes)});
 }
 async function optional(relative) {
  try {await readFile(join(source,relative));return true;}
  catch(error){if(error.code==='ENOENT')return false;throw error;}
 }
 await copyFile('w2c2/w2c2_base.h');
 if(await optional('w2c2/w2c2_simd.h')) {
  await copyFile('w2c2/w2c2_simd.h');
  async function copyTree(relative) {
   for(const entry of (await readdir(join(source,relative),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
    const child=relative+'/'+entry.name;
    if(entry.isDirectory())await copyTree(child);
    else if(entry.isFile())await copyFile(child);
    else throw Error('Unsupported w2c2 SIMD dependency entry: '+child);
   }
  }
  await copyTree('w2c2/simde');
 }
 const nativeSources=[];
 if(await optional('futex/futex.c')) {
  // futex.h retains its upstream ../w2c2/w2c2_base.h include path.
  await copyFile('w2c2/w2c2_base.h','w2c2/w2c2_base.h');
  for(const name of ['futex','list','map']) {
   await copyFile('futex/'+name+'.h','futex/'+name+'.h');
   await copyFile('futex/'+name+'.c','futex/'+name+'.c');
   nativeSources.push(join(sdk,'futex',name+'.c'));
  }
 }
 return {files,nativeSources,nativeCompilePolicy:'compile runtime sources with the same bounds, SIMD and thread flags as generated guest C'};
}

export async function buildCTranspilerSDK({source,sdk,target,engine,env,run}) {
 if(!['wasm2c','w2c2'].includes(engine))throw Error('Unknown C transpiler');
 await mkdir(join(sdk,'bin'),{recursive:true});
 let binary,flags,simde=null,runtimeSupport=null;
 if(engine==='wasm2c'){
  await run('git',['submodule','update','--init','--recursive','--depth','1'],{cwd:source});
  flags=['-DCMAKE_BUILD_TYPE=Release','-DBUILD_TESTS=OFF','-DBUILD_LIBWASM=OFF'];
  if(env.WASMFYI_WASM2C_BUILD_CC)flags.push('-DCMAKE_C_COMPILER='+env.WASMFYI_WASM2C_BUILD_CC);
  if(env.WASMFYI_WASM2C_BUILD_CXX)flags.push('-DCMAKE_CXX_COMPILER='+env.WASMFYI_WASM2C_BUILD_CXX);
  await run('cmake',['-S',source,'-B',target,...flags]);await run('cmake',['--build',target,'--target','wasm2c','--parallel',String(env.WASMFYI_BUILD_JOBS||availableParallelism())]);
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
  await run('cmake',['-S',join(source,'w2c2'),'-B',target,...flags]);await run('cmake',['--build',target,'--target','w2c2','--parallel',String(env.WASMFYI_BUILD_JOBS||availableParallelism())]);
  binary=join(target,'w2c2');await cp(binary,join(sdk,'bin/w2c2'));
  runtimeSupport=await packageW2c2Runtime({source,sdk});
 }
 env['WASMBENCH_'+engine.toUpperCase()]=join(sdk,'bin',engine);env['WASMBENCH_'+engine.toUpperCase()+'_SDK']=sdk;
 return {source,sdk,engine,flags,...(simde?{simde}:{}),...(runtimeSupport?{runtimeSupport}:{}),translator:env['WASMBENCH_'+engine.toUpperCase()],translatorSha256:digest(await readFile(binary))};
}
