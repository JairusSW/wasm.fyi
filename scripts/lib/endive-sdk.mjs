import {readFile,writeFile,mkdir,readdir,stat,realpath} from 'node:fs/promises';
import {join,dirname,isAbsolute} from 'node:path';
import {availableParallelism} from 'node:os';
import {digest,site} from './wasmbench.mjs';
import {withEndiveTimingCodeSize} from './endive-timing-code.mjs';
import {withEndiveLegacyNativeAPI} from './endive-legacy-api.mjs';
import {ensureEndiveBridge} from './endive-bridge.mjs';
export function endiveAdapterSource(source,version,configuration){
 const pinned=source.replaceAll('3c6d9cbdc9e96671f2526604d95ecd4ecfaf374c',version);
 return configuration==='endive-redline'?withEndiveLegacyNativeAPI(withEndiveTimingCodeSize(pinned)):pinned;
}
export async function ensureEndiveJFFI({source,sdk,run}){
 // The runner declares jffi as provided. Add only that source-resolved
 // dependency alongside the normal runtime classpath.
 await run('bash',[join(source,'mvnw'),'-B','-Predline','-pl','redline/runner-jffi','dependency:copy-dependencies','-DincludeScope=compile','-DincludeArtifactIds=jffi','-DoutputDirectory='+sdk],{cwd:source});
 const binding=(await readdir(sdk)).find(name=>/^jffi-[\d.]+\.jar$/.test(name));
 if(!binding)throw Error('Redline source-resolved JFFI dependency is missing');
 const version=binding.slice(5,-4),native=join(sdk,'jffi-'+version+'-native.jar');
 if(!await stat(native).catch(()=>null))await run('curl',['--fail','--location','--retry','3','--max-time','180','https://repo.maven.apache.org/maven2/com/github/jnr/jffi/'+version+'/jffi-'+version+'-native.jar','-o',native]);
 return {version,scope:'provided; source-resolved compile dependency',bindingSha256:digest(await readFile(join(sdk,binding))),nativeSha256:digest(await readFile(native))};
}
export async function compileEndiveAdapter({java,sdk,classes,path,run}){
 await run(join(dirname(java),'javac'),['-proc:none','-cp',sdk+'/*','-d',classes,path]);
}
export async function endiveJavaEnvironment(env,run){
 const selected=env.WASMFYI_ENDIVE_JAVA||env.WASMBENCH_JAVA||env.WASMFYI_CHASM_JAVA||'java';
 const java=await realpath(isAbsolute(selected)?selected:(await run('which',[selected],{signal:AbortSignal.timeout(10000)})).output.trim());
 env.WASMBENCH_JAVA=java;env.JAVA_HOME=dirname(dirname(java));
 // macOS's /usr/bin/java can wait forever for a missing-JDK GUI prompt.
 // Qualify the selected executable before Maven starts its build.
 await run(java,['-version'],{env,signal:AbortSignal.timeout(10000)});
 return java;
}
export function reusableEndiveSDK(configuration,names){
 if(configuration==='endive-redline')return false;
 return ['wasm','runtime','compiler'].every(module=>names.some(name=>name.startsWith(module+'-')&&name.endsWith('.jar')));
}
export async function buildEndiveSDK({source,root,version,configuration,env,run}){
 const java=await endiveJavaEnvironment(env,run);
 const modules=['wasm','runtime','compiler'];
 const mavenProfile=configuration==='endive-redline'?['-Predline']:[];
 if(configuration==='endive-redline')modules.push('redline/compiler','redline/runner-jffi');
 for(const module of modules)if(!await stat(join(source,module,'pom.xml')).catch(()=>null))throw Error('Pinned Endive source lacks required SDK module: '+module);
 const sdk=join(root,'endive-sdk'),classes=join(root,'endive-classes');await mkdir(sdk,{recursive:true});await mkdir(classes,{recursive:true});
 const cached=reusableEndiveSDK(configuration,await readdir(sdk));
 // Resolve the source's immutable lock, since historical SNAPSHOT tags move.
 // Skip Inlay's tag lookup only after verifying both the manifest and Wasm.
 const bridge=configuration==='endive-redline'?await ensureEndiveBridge({source,env,run}):null;
 if(!cached)await run('bash',[join(source,'mvnw'),'-B',...mavenProfile,'-T',String(env.WASMFYI_BUILD_JOBS||availableParallelism()),'-pl',modules.join(','),'-am','-Dmaven.test.skip=true','-Dcheckstyle.skip=true','-Dspotless.skip=true','-Dmdep.analyze.skip=true',...(bridge?['-Dinlay.skip=true']:[]),'install'],{cwd:source});
 const jars=[];
 const collect=async(directory)=>{
  for(const item of await readdir(directory,{withFileTypes:true})){
   if(['.git','node_modules'].includes(item.name))continue;
   const path=join(directory,item.name);
   if(item.isDirectory())await collect(path);
   else if(directory.endsWith('/target')&&item.name.endsWith('.jar')&&!/-(tests|sources|javadoc)\.jar$/.test(item.name)){
    const destination=join(sdk,item.name);await writeFile(destination,await readFile(path));jars.push(destination);
   }
  }
 };
 if(!cached){await collect(source);
  for(const module of ['compiler',...(configuration==='endive-redline'?['redline/runner-jffi']:[])])await run('bash',[join(source,'mvnw'),'-B',...mavenProfile,'-pl',module,'dependency:copy-dependencies','-DincludeScope=runtime','-DoutputDirectory='+sdk],{cwd:source});
 }
 const jffi=configuration==='endive-redline'?await ensureEndiveJFFI({source,sdk,run}):null;
 const json=join(sdk,'json-20250517.jar');
 if(!await stat(json).catch(()=>null))await run('curl',['--fail','--location','--retry','3','--max-time','180','https://repo.maven.apache.org/maven2/org/json/json/20250517/json-20250517.jar','-o',json]);
 if(digest(await readFile(json))!=='3ea61b2a06e31edf1c91134fe9106b0ebb16628be169f3db75bc7a2b06b45796')throw Error('JSON protocol library checksum differs');
 const adapter=endiveAdapterSource(await readFile(join(site,'adapters/qualification/EndiveAdapter.java'),'utf8'),version,configuration);
 const path=join(root,'EndiveAdapter.java');await writeFile(path,adapter);
 await compileEndiveAdapter({java,sdk,classes,path,run});
 return {source,version,java,configuration,jffi,bridge,adapterSha256:digest(Buffer.from(adapter)),libraries:await Promise.all((await readdir(sdk)).filter(name=>name.endsWith('.jar')).map(async name=>({name,sha256:digest(await readFile(join(sdk,name)))}))),nativeCodePolicy:configuration==='endive-redline'?'NativeCode.image executable image':'JVM does not expose artifact-attributed native machine code; n/a'};
}
