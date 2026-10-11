import {readFile,writeFile,mkdir,stat,symlink,realpath} from 'node:fs/promises';
import {join,dirname,isAbsolute} from 'node:path';
import {availableParallelism} from 'node:os';
import {digest,site} from './wasmbench.mjs';
export async function buildChasmSDK({source,root,version,env,run}){
 const selectedJava=env.WASMFYI_CHASM_JAVA||env.WASMBENCH_JAVA||'java';
 const java=await realpath(isAbsolute(selectedJava)?selectedJava:(await run('which',[selectedJava])).output.trim());
 env.WASMBENCH_JAVA=java;env.JAVA_HOME=dirname(dirname(java));
 const properties=(await run(java,['-XshowSettings:properties','-version'],{env})).output;
 const major=Number(properties.match(/java\.specification\.version\s*=\s*(\d+)/)?.[1]);
 if(!Number.isInteger(major)||major<25)throw Error('Pinned Chasm source requires Java25 or newer; selected '+java);
 const name='wasmfyi-adapter',module=join(source,name);
 await mkdir(join(module,'src/main/kotlin'),{recursive:true});
 const settings=join(source,'settings.gradle.kts');let text=await readFile(settings,'utf8');
 if(!text.includes('include(":'+name+'")'))await writeFile(settings,text+'\ninclude(":'+name+'")\n');
 await writeFile(join(module,'build.gradle.kts'),`plugins { alias(libs.plugins.kotlin.jvm); application }
kotlin { jvmToolchain(25); compilerOptions { freeCompilerArgs.add("-Xcontext-parameters") } }
dependencies { implementation(project(":chasm")); implementation("org.json:json:20250517") }
application { mainClass.set("ChasmAdapterKt"); applicationDefaultJvmArgs=listOf("-XX:ActiveProcessorCount=1","-XX:+UseSerialGC","-Xbatch") }
`);
 const adapter=(await readFile(join(site,'adapters/qualification/ChasmAdapter.kt'),'utf8')).replaceAll('source-main-2.2.0-SNAPSHOT',version);
 await writeFile(join(module,'src/main/kotlin/ChasmAdapter.kt'),adapter);
 await run('bash',[join(source,'gradlew'),':'+name+':installDist','--no-daemon','-Dorg.gradle.java.home='+env.JAVA_HOME,'--max-workers='+String(env.WASMFYI_BUILD_JOBS||availableParallelism())],{cwd:source,env});
 const distribution=join(module,'build/install',name),launcher=join(distribution,'bin',name);
 if(!await stat(launcher).catch(()=>null))throw Error('Pinned Chasm build did not produce its adapter launcher');
 await mkdir(join(root,'bin'),{recursive:true});const binary=join(root,'bin/adapter-chasm');
 if(!await stat(binary).catch(()=>null))await symlink(launcher,binary);
 const command=[java,'-XX:ActiveProcessorCount=1','-XX:+UseSerialGC','-Xbatch','-cp',join(distribution,'lib','*'),'ChasmAdapterKt'];
 const commandFile=join(root,'bin/chasm-command.json');
 await writeFile(commandFile,JSON.stringify(command)+'\n');
 return {source,version,distribution,java,commandFile,adapterSha256:digest(Buffer.from(adapter)),launcherSha256:digest(await readFile(launcher)),nativeCodePolicy:'Wasm interpreter; artifact-attributed native code n/a'};
}
