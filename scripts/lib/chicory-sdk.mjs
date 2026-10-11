import {withChicorySimd} from './chicory-simd.mjs';
import {readFile,writeFile,mkdir,readdir,rm,stat,realpath} from 'node:fs/promises';
import {join,dirname,isAbsolute} from 'node:path';
import {homedir} from 'node:os';
import {digest,site} from './wasmbench.mjs';
export async function buildChicorySDK({source,root,version,configuration='chicory',env,run}) {
 const java=env.WASMFYI_CHICORY_JAVA||env.WASMBENCH_JAVA||'java';
 const executable=await realpath(isAbsolute(java)?java:(await run('which',[java])).output.trim());
 const javaBin=dirname(executable);env.WASMBENCH_JAVA=executable;env.JAVA_HOME=dirname(javaBin);
 const jit=configuration==='chicory-jit',simd=!jit&&env.WASMFYI_CHICORY_SIMD==='1',modules=jit?['runtime','wasm','compiler']:simd?['runtime','wasm','simd']:['runtime','wasm'];
 if(simd)env.JAVA_TOOL_OPTIONS=[env.JAVA_TOOL_OPTIONS||'','--add-modules=jdk.incubator.vector'].filter(Boolean).join(' ');
 await run('bash',[join(source,'mvnw'),'-B','-pl',modules.join(','),'-am','-Dmaven.test.skip=true','-Dcheckstyle.skip=true','-Dspotless.skip=true','-Dmdep.analyze.skip=true',jit?'install':'package'],{cwd:source});
 const jars=[];
 for(const module of modules){
  const target=join(source,module,'target');const names=(await readdir(target)).filter(name=>name.endsWith('.jar')&&!/-(?:tests|sources|javadoc)\.jar$/.test(name));
  if(names.length!==1)throw Error('Ambiguous Chicory production JAR: '+module+' '+names);
  jars.push(join(target,names[0]));
 }
 if(jit){
  const dependencies=join(root,'chicory-jit-dependencies');await mkdir(dependencies,{recursive:true});
  await run('bash',[join(source,'mvnw'),'-B','-pl','compiler','dependency:copy-dependencies','-DincludeScope=runtime','-DincludeGroupIds=org.ow2.asm','-DoutputDirectory='+dependencies],{cwd:source});
  for(const name of await readdir(dependencies))if(name.endsWith('.jar'))jars.push(join(dependencies,name));
 }
 const json=join(homedir(),'.cache/wasm-fyi/toolchains/json-20250517.jar');await mkdir(dirname(json),{recursive:true});
 if(!await stat(json).catch(()=>null))await run('curl',['--fail','--location','--retry','3','--max-time','180','https://repo.maven.apache.org/maven2/org/json/json/20250517/json-20250517.jar','-o',json]);
 if(digest(await readFile(json))!=='3ea61b2a06e31edf1c91134fe9106b0ebb16628be169f3db75bc7a2b06b45796')throw Error('JSON protocol library checksum differs');
 jars.push(json);
 const classes=join(root,'chicory-classes');await mkdir(classes,{recursive:true});
 for(const jar of jars)await run(join(javaBin,'jar'),['xf',jar],{cwd:classes});
 await rm(join(classes,'META-INF'),{recursive:true,force:true});await rm(join(classes,'module-info.class'),{force:true});
 const className=jit?'ChicoryJitAdapter':'ChicoryAdapter';
 let adapter=await readFile(join(site,jit?'adapters/qualification/ChicoryJitAdapter.java':'adapters/features/ChicoryAdapter.java'),'utf8');
 const anchor=jit?'e2e2e4058f49fbffeffc5ea92c54b41534cb45d3':'1.7.5';
 if(!adapter.includes('"runtime_version":"'+anchor+'"'))throw Error('Chicory version injection anchor missing');
 adapter=adapter.replaceAll(anchor,version);if(simd)adapter=withChicorySimd(adapter);
 const path=join(root,className+'.java');await writeFile(path,adapter);
 await run(join(javaBin,'javac'),['--release','21',...(simd?['--add-modules','jdk.incubator.vector']:[]),'-cp',jars.join(':'),'-d',classes,path]);
 await mkdir(join(root,'bin'),{recursive:true});const binary=join(root,'bin/adapter-'+configuration+'.jar');
 await run(join(javaBin,'jar'),['--create','--file',binary,'--main-class',className,'-C',classes,'.']);
 await rm(classes,{recursive:true,force:true});
 let threadPolicy=null;
 if(process.platform==='darwin'){
  const library=join(root,'bin/darwin-thread-qos.dylib'),launcher=join(root,'bin/darwin-qos-launch');
  await run('clang',['-O2','-Wall','-Wextra','-Werror','-dynamiclib',join(site,'scripts/native/darwin-thread-qos.c'),'-o',library]);
  await run('clang',['-O2','-Wall','-Wextra','-Werror',join(site,'scripts/native/darwin-qos-launch.c'),'-o',launcher]);
  env.WASMBENCH_DARWIN_QOS_LAUNCHER=launcher;env.WASMBENCH_DARWIN_THREAD_QOS=library;
  threadPolicy={class:'user-interactive',scope:'Main and pthread-start QoS; physical CPU affinity is not guaranteed',library,librarySha256:digest(await readFile(library)),launcher,launcherSha256:digest(await readFile(launcher))};
 }
 return {source,version,configuration,java:executable,simdMachine:simd,javaToolOptions:env.JAVA_TOOL_OPTIONS||null,threadPolicy,adapterSha256:digest(Buffer.from(adapter)),binarySha256:digest(await readFile(binary)),libraries:await Promise.all(jars.map(async path=>({path,sha256:digest(await readFile(path))}))),nativeCodePolicy:jit?'Artifact-attributed JVM native code is unavailable; generated Java bytecode is not machine code':'Wasm interpreter: native code size is unavailable; JVM JIT implementation code is not attributed to Wasm artifacts'};
}
