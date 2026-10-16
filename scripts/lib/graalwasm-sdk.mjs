import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {homedir} from 'node:os';
import {digest,site} from './wasmbench.mjs';
// Source driver and JVMCI policy used by the successful AMD64 source build.
export const graalMxRevision='6c9b38f3373eff9cc7dc9fc21ca4e116dd93786b';
export function configureGraalFeatureOptions(adapter,names) {
 if(!Array.isArray(names)||names.some(name=>typeof name!=='string'||!name.startsWith('wasm.')||name.length===5))throw Error('Invalid Graal Wasm option descriptors');
 const available=new Set(names);
 for(const required of ['wasm.EvalReturnsInstance','wasm.UseUnsafeMemory','wasm.AsyncParsingBinarySize'])if(!available.has(required))throw Error('Graal SDK lacks required measurement option '+required);
 const declaration=/static final List<String> FEATURE_OPTIONS=List\.of\(([^\n]*)\);/g;
 const matches=[...adapter.matchAll(declaration)];
 if(matches.length!==1)throw Error('Graal feature option declaration changed');
 const requested=JSON.parse('['+matches[0][1]+']');
 if(requested.some(name=>typeof name!=='string'||!/^[A-Za-z][A-Za-z0-9]*$/.test(name)))throw Error('Invalid Graal feature option names');
 const enabled=requested.filter(name=>available.has('wasm.'+name)),unavailable=requested.filter(name=>!available.has('wasm.'+name));
 return {adapter:adapter.replace(declaration,'static final List<String> FEATURE_OPTIONS=List.of('+enabled.map(name=>JSON.stringify(name)).join(',')+');'),enabled,unavailable};
}
export function upgradeGraalRuntimeArguments(extension){
 if(!extension.includes('def wasmfyi_runtime_configuration('))return extension;
 const before='    vm_args = ["--enable-native-access=ALL-UNNAMED", "-XX:ActiveProcessorCount=1", "-XX:+UseSerialGC", "-Xbatch"]';
 const after='    import sys\n    vm_args = ["--enable-native-access=ALL-UNNAMED", "-XX:ActiveProcessorCount=1", "-XX:+UseSerialGC"]\n    if sys.platform != "darwin":\n        vm_args.append("-Xbatch")';
 if(extension.includes(after))return extension;
 if(!extension.includes(before))throw Error('Graal runtime argument extension changed');
 return extension.replace(before,after);
}
export function upgradeGraalRuntimeExports(extension){
 if(!extension.includes('def wasmfyi_runtime_configuration('))return extension;
 const before='["org.graalvm.wasm", "org.graalvm.wasm.memory", "org.graalvm.wasm.predefined"]';
 const after='["org.graalvm.wasm", "org.graalvm.wasm.api", "org.graalvm.wasm.memory", "org.graalvm.wasm.predefined"]';
 if(extension.includes(after))return extension;
 if(!extension.includes(before))throw Error('Graal runtime export extension changed');
 return extension.replace(before,after);
}
export function configureGraalJava(env){
 // A generic JVM selection can lack the JVMCI APIs required by /compiler.
 // Let mx select its qualified Labs JDK unless a Graal-specific JDK is given.
 if(env.WASMFYI_GRAAL_JAVA)env.JAVA_HOME=dirname(dirname(env.WASMFYI_GRAAL_JAVA));
 else delete env.JAVA_HOME;
}
export async function ensureGraalDriver(mxRoot,run){
 const revision=(await run('git',['-C',mxRoot,'rev-parse','HEAD'])).output.trim();
 if(revision===graalMxRevision)return revision;
 if((await run('git',['-C',mxRoot,'status','--porcelain','--untracked-files=no'])).output.trim())throw Error('Graal mx driver has local tracked changes');
 await run('git',['-C',mxRoot,'fetch','--depth','1','origin',graalMxRevision]);
 await run('git',['-C',mxRoot,'checkout','--detach',graalMxRevision]);
 const selected=(await run('git',['-C',mxRoot,'rev-parse','HEAD'])).output.trim();
 if(selected!==graalMxRevision)throw Error('Graal mx driver revision differs from qualified source build');
 return selected;
}
// Build the selected Graal source, including its optimized Truffle compiler.
// Upstream workflow: wasm/docs/contributor/Building.md.
export async function buildGraalWasmSDK({source,root,version,env,run}){
 const mxRoot=join(homedir(),'.cache/wasm-fyi/toolchains/mx');
 if(!await stat(join(mxRoot,'.git')).catch(()=>null)){
  await mkdir(dirname(mxRoot),{recursive:true});
  await run('git',['clone','--depth','1','https://github.com/graalvm/mx.git',mxRoot]);
 }
 const mx=join(mxRoot,'mx'),wasm=join(source,'wasm'),extension=join(wasm,'mx.wasm/mx_wasm.py');
 const driverRevision=await ensureGraalDriver(mxRoot,run);
 configureGraalJava(env);
 let python=await readFile(extension,'utf8');
 const upgraded=upgradeGraalRuntimeArguments(upgradeGraalRuntimeExports(python));
 if(upgraded!==python){await writeFile(extension,upgraded);python=upgraded;}
 if(!python.includes('def wasmfyi_runtime_configuration('))await writeFile(extension,python+`
@mx.command(_suite.name, "wasmfyi-runtime-configuration")
def wasmfyi_runtime_configuration(args):
    import json
    distributions = [*mx_truffle.resolve_truffle_dist_names(use_optimized_runtime=True), "WASM"]
    import sys
    vm_args = ["--enable-native-access=ALL-UNNAMED", "-XX:ActiveProcessorCount=1", "-XX:+UseSerialGC"]
    if sys.platform != "darwin":
        vm_args.append("-Xbatch")
    mx_truffle.enable_sun_misc_unsafe(vm_args)
    vm_args += mx.get_runtime_jvm_args(distributions)
    for package in ["org.graalvm.wasm", "org.graalvm.wasm.api", "org.graalvm.wasm.memory", "org.graalvm.wasm.predefined"]:
        vm_args.append("--add-exports=org.graalvm.wasm/" + package + "=ALL-UNNAMED")
    print(json.dumps({"java": get_jdk().java, "classpath": mx.classpath(distributions), "arguments": vm_args}))
`);
 await run(mx,['--dynamicimports','/compiler','build'],{cwd:wasm});
 const output=(await run(mx,['--dynamicimports','/compiler','wasmfyi-runtime-configuration'],{cwd:wasm})).output;
 const line=output.trim().split('\n').findLast(line=>line.startsWith('{'));
 if(!line)throw Error('Graal source build did not report its optimized runtime configuration');
 const configuration=JSON.parse(line),classes=join(root,'graal-classes');await mkdir(classes,{recursive:true});
 const json=join(root,'json-20250517.jar');
 if(!await stat(json).catch(()=>null))await run('curl',['--fail','--location','--retry','3','--max-time','180','https://repo.maven.apache.org/maven2/org/json/json/20250517/json-20250517.jar','-o',json]);
 if(digest(await readFile(json))!=='3ea61b2a06e31edf1c91134fe9106b0ebb16628be169f3db75bc7a2b06b45796')throw Error('JSON protocol library checksum differs');
 const optionsPath=join(root,'GraalWasmOptions.java'),optionsSource=await readFile(join(site,'adapters/qualification/GraalWasmOptions.java'));
 await writeFile(optionsPath,optionsSource);
 const javac=join(dirname(configuration.java),'javac');
 await run(javac,['-cp',configuration.classpath+':'+json,'-d',classes,optionsPath]);
 const optionsOutput=(await run(configuration.java,[...configuration.arguments,'-cp',classes+':'+json,'GraalWasmOptions'])).output;
 const optionsLine=optionsOutput.trim().split('\n').findLast(line=>line.startsWith('{'));
 if(!optionsLine)throw Error('Graal SDK did not report its supported Wasm options');
 const features=configureGraalFeatureOptions((await readFile(join(site,'adapters/qualification/GraalWasmAdapter.java'),'utf8')).replaceAll('25.4.4.1.1',version),JSON.parse(optionsLine).wasmOptions);
 const adapter=features.adapter;
 const adapterPath=join(root,'GraalWasmAdapter.java');await writeFile(adapterPath,adapter);
 await run(join(dirname(configuration.java),'javac'),['-cp',configuration.classpath+':'+json,'-d',classes,adapterPath]);
 const command=[configuration.java,...configuration.arguments,'-cp',classes+':'+json,'GraalWasmAdapter'];
 await mkdir(join(root,'bin'),{recursive:true});await writeFile(join(root,'bin/graalwasm-command.json'),JSON.stringify(command)+'\n');
 return {source,version,driverRevision,java:configuration.java,arguments:configuration.arguments,featureOptions:features.enabled,unavailableFeatureOptions:features.unavailable,optionsDiscoverySha256:digest(optionsSource),adapterSha256:digest(Buffer.from(adapter)),nativeCodePolicy:'Artifact-attributed Truffle native code measurement is not yet qualified; InstalledCode APIs require module ownership and extent validation'};
}
