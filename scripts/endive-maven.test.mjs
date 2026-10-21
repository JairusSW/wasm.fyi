import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildEndiveSDK,reusableEndiveSDK} from './lib/endive-sdk.mjs';

test('completed revision-specific core SDKs resume without rebuilding Maven',()=>{
 const jars=['wasm-999-SNAPSHOT.jar','runtime-999-SNAPSHOT.jar','compiler-999-SNAPSHOT.jar'];
 assert.equal(reusableEndiveSDK('endive-interpreter',jars),true);
 assert.equal(reusableEndiveSDK('endive-jit',jars),true);
 assert.equal(reusableEndiveSDK('endive-redline',jars),false);
 assert.equal(reusableEndiveSDK('endive-jit',jars.slice(1)),false);
});

for(const configuration of ['endive-redline','endive-jit'])test(configuration+' selects its Maven reactor without running a compiler',async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'endive-reactor-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const source=join(root,'source'),java=join(root,'jdk/bin/java');
 await mkdir(join(root,'jdk/bin'),{recursive:true});await writeFile(java,'fixture');
 for(const module of ['wasm','runtime','compiler','redline/compiler','redline/runner-jffi']){
  await mkdir(join(source,module),{recursive:true});await writeFile(join(source,module,'pom.xml'),'<project/>');
 }
 await writeFile(join(source,'pom.xml'),'<project><profiles><profile><id>redline</id><modules><module>redline</module></modules></profile></profiles></project>');
 const build=join(source,'redline/wasm-build');await mkdir(build);
 await writeFile(join(build,'Cargo.lock'),'version = 4\n');await writeFile(join(build,'Cargo.toml'),'[package]\nname = "cranelift-bridge"\n');
 const stop=Error('Maven invocation inspected; do not build'),calls=[];
 await assert.rejects(buildEndiveSDK({source,root,version:'fixture',configuration,env:{WASMFYI_ENDIVE_JAVA:java,WASMFYI_BUILD_JOBS:'8'},run:async(program,args)=>{
  calls.push({program,args});
  if(program===java)return {output:'openjdk version 25'};
  if(program==='rustup')return {output:'wasm32-wasip1\n'};
  if(program==='cargo'){
   const out=join(build,'target/wasm32-wasip1/release');await mkdir(out,{recursive:true});await writeFile(join(out,'cranelift_bridge.wasm'),Buffer.from([0,97,115,109,1,0,0,0]));return {output:''};
  }
  assert.equal(program,'bash');throw stop;
 }}),error=>error===stop);
 const args=calls.find(v=>v.program==='bash').args;
 assert.equal(args.includes('-Predline'),configuration==='endive-redline','Redline modules require the explicit upstream reactor profile');
 assert.equal(args[args.indexOf('-T')+1],'8');
 assert.equal(args[args.indexOf('-pl')+1],configuration==='endive-redline'?'wasm,runtime,compiler,redline/compiler,redline/runner-jffi':'wasm,runtime,compiler');
});
