import {readFile,writeFile,mkdir,readdir,chmod,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {availableParallelism} from 'node:os';
import {digest,site} from './wasmbench.mjs';
export async function buildZwasmSDK({source,root,version,env,run}){
 const zig=env.WASMFYI_ZIG||'zig';
 const compilerVersion=(await run(zig,['version'])).output.trim();
 for(const name of ['prepare-zwasm-compile-cache.mjs','prepare-zwasm-native-size.mjs'])await run(process.execPath,[join(site,'scripts',name),source]);
 const flags=['static-lib','-Doptimize=ReleaseFast','-Dcompiler-rt=true','-Dengine=both','-Dwasi=p3','-j'+String(env.WASMFYI_BUILD_JOBS||availableParallelism())];
 await run(zig,['build',...flags],{cwd:source});
 let archive=join(source,'zig-out/lib/libzwasm.a');
 if(!await stat(archive).catch(()=>null))throw Error('Pinned Zwasm SDK did not produce its static library');
 if(process.platform==='darwin'){
  const objects=join(root,'zwasm-link-objects');await mkdir(objects,{recursive:true});
  await run('ar',['-x',archive],{cwd:objects});
  const paths=(await readdir(objects)).filter(name=>name.endsWith('.o')).map(name=>join(objects,name));
  if(!paths.length)throw Error('Zwasm SDK archive contains no native objects');
  for(const path of paths)await chmod(path,0o600);
  archive=join(root,'libzwasm-repacked.a');await run('libtool',['-static','-o',archive,...paths]);
 }
 const adapter=join(root,'adapters/zwasm');await mkdir(adapter,{recursive:true});
 for(const name of ['adapter.py','embedding.h','bridge.cpp']){
  const bytes=await readFile(join(site,'adapters/qualification/zwasm',name));
  await writeFile(join(adapter,name),name==='bridge.cpp'?bytes.toString().replaceAll('b84f9f97654819b83189d385092726b3dadb1251',version):bytes);
 }
 const library=join(root,'bin',process.platform==='darwin'?'libzwasm-adapter.dylib':'libzwasm-adapter.so');
 await mkdir(join(root,'bin'),{recursive:true});
 await run('clang++',['-std=c++20','-O3',process.platform==='darwin'?'-dynamiclib':'-shared',...(process.platform==='darwin'?[]:['-fPIC']),'-I',join(source,'zig-out/include'),join(adapter,'bridge.cpp'),archive,...(process.platform==='darwin'?[]:['-lm','-Wl,-z,noexecstack']),'-o',library]);
 return {source,version,compilerVersion,flags,library,librarySha256:digest(await readFile(library)),nativeCodePolicy:'Module executable allocation plus instance-owned import thunks; interpreter n/a',moduleLifetimePolicy:'Original SDK module stays alive until all adapter-owned instances are released and the store closes'};
}
