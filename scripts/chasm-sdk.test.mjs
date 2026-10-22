import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {buildChasmSDK} from './lib/chasm-sdk.mjs';
async function fixture(major,body){
 const temp=await realpath(await mkdtemp(join(tmpdir(),'chasm-java-')));
 try{
  const source=join(temp,'source'),root=join(temp,'harness'),java=join(temp,'jdk/bin/java');
  await mkdir(join(temp,'jdk/bin'),{recursive:true});await mkdir(source,{recursive:true});await writeFile(java,'selected Java');await writeFile(join(source,'settings.gradle.kts'),'include(":chasm")\n');
  const calls=[],env={WASMFYI_CHASM_JAVA:java,WASMBENCH_JAVA:'/unused/java17',WASMFYI_BUILD_JOBS:'8'};
  const run=async(program,args,options)=>{
   calls.push({program,args,options});
   if(program===java)return {output:'java.specification.version = '+major+'\n'};
   assert.equal(program,'bash');assert.equal(options.env.JAVA_HOME,join(temp,'jdk'));
   const distribution=join(source,'wasmfyi-adapter/build/install/wasmfyi-adapter');await mkdir(join(distribution,'bin'),{recursive:true});await writeFile(join(distribution,'bin/wasmfyi-adapter'),'launcher');return {output:''};
  };
  await body({source,root,java,env,run,calls,temp});
 }finally{await rm(temp,{recursive:true,force:true})}
}
test('Chasm pins Java25 for both Gradle build and direct runtime without limiting build workers',async()=>fixture(25,async f=>{
 const receipt=await buildChasmSDK({...f,version:'source-hash'});
 assert.equal(receipt.java,f.java);assert.equal(f.calls.length,2);
 assert(f.calls[1].args.includes('-Dorg.gradle.java.home='+join(f.temp,'jdk')));assert(f.calls[1].args.includes('--max-workers=8'));
 const command=JSON.parse(await readFile(receipt.commandFile));assert.equal(command[0],f.java);assert(command.includes('-XX:ActiveProcessorCount=1'));assert(command.includes('-Xbatch'));
}));
test('too-old Java fails before invoking Gradle or writing a launcher',async()=>fixture(17,async f=>{
 await assert.rejects(buildChasmSDK({...f,version:'source-hash'}),/requires Java25/);assert.equal(f.calls.length,1);
}));

const legacyHostPath='chasm/src/commonMain/kotlin/io/github/charlietap/chasm/embedding/shapes';
const legacyHostAPI='typealias HostFunction = HostFunctionContext.(List<ExecutionValue>) -> List<ExecutionValue>\n';
test('historical Chasm callbacks use its real list-based public host API',async()=>fixture(25,async f=>{
 await mkdir(join(f.source,legacyHostPath),{recursive:true});await writeFile(join(f.source,legacyHostPath,'HostFunction.kt'),legacyHostAPI);
 const receipt=await buildChasmSDK({...f,version:'1.7.0'});
 const adapter=await readFile(join(f.source,'wasmfyi-adapter/src/main/kotlin/ChasmAdapter.kt'),'utf8');
 assert(adapter.includes('reference { parameters -> parameters }'));
 assert(adapter.includes('reference { _ -> error("AssemblyScript abort") }'));
 assert(!adapter.includes('HostFunction{'));assert(!adapter.includes('parameters.readI32'));
 assert.equal(receipt.hostCallbackPolicy,'execution-value-list-v1');
}));
test('unknown historical callback type aliases fail before Gradle compilation',async()=>fixture(25,async f=>{
 await mkdir(join(f.source,legacyHostPath),{recursive:true});await writeFile(join(f.source,legacyHostPath,'HostFunction.kt'),'typealias HostFunction = UnknownABI\n');
 await assert.rejects(buildChasmSDK({...f,version:'unknown'}),/Unsupported Chasm host callback API/);
 assert.equal(f.calls.length,1);
}));

test('Chasm enables extended-name decoding in both fresh and cached module paths',async()=>fixture(25,async f=>{
 await buildChasmSDK({...f,version:'source-hash'});
 const adapter=await readFile(join(f.source,'wasmfyi-adapter/src/main/kotlin/ChasmAdapter.kt'),'utf8');
 assert(adapter.includes('ModuleConfig(decodeNameSection=true)'));
 assert.equal(adapter.match(/module\(bytes,config\)/g)?.length,2);
 assert(adapter.includes('.put("features",JSONArray(listOf("extended-name-section")))'));
 assert(!adapter.includes('module(bytes).expect'));
}));
