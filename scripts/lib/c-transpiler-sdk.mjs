import {mkdir,readFile,readdir,cp} from 'node:fs/promises';
import {join} from 'node:path';
import {digest} from './wasmbench.mjs';
export async function buildCTranspilerSDK({source,sdk,target,engine,env,run}) {
 if(!['wasm2c','w2c2'].includes(engine))throw Error('Unknown C transpiler');
 await mkdir(join(sdk,'bin'),{recursive:true});
 let binary,flags;
 if(engine==='wasm2c'){
  await run('git',['submodule','update','--init','--recursive','--depth','1'],{cwd:source});
  flags=['-DCMAKE_BUILD_TYPE=Release','-DBUILD_TESTS=OFF','-DBUILD_LIBWASM=OFF'];
  await run('cmake',['-S',source,'-B',target,...flags]);await run('cmake',['--build',target,'--target','wasm2c','-j','2']);
  binary=join(target,'wasm2c');await cp(binary,join(sdk,'bin/wasm2c'));
  await mkdir(join(sdk,'include'),{recursive:true});await mkdir(join(sdk,'share/wabt/wasm2c'),{recursive:true});
  for(const name of await readdir(join(source,'wasm2c')))if(name.startsWith('wasm-rt')&&/\.(?:h|c|inc)$/.test(name)){
   await cp(join(source,'wasm2c',name),join(sdk,name.endsWith('.h')?'include':'share/wabt/wasm2c',name));
  }
 } else {
  flags=['-DCMAKE_BUILD_TYPE=Release','-DSHARED_LIB=OFF'];
  await run('cmake',['-S',join(source,'w2c2'),'-B',target,...flags]);await run('cmake',['--build',target,'--target','w2c2','-j','2']);
  binary=join(target,'w2c2');await cp(binary,join(sdk,'bin/w2c2'));
  await cp(join(source,'w2c2/w2c2_base.h'),join(sdk,'w2c2_base.h'));
 }
 env['WASMBENCH_'+engine.toUpperCase()]=join(sdk,'bin',engine);env['WASMBENCH_'+engine.toUpperCase()+'_SDK']=sdk;
 return {source,sdk,engine,flags,translator:env['WASMBENCH_'+engine.toUpperCase()],translatorSha256:digest(await readFile(binary))};
}
