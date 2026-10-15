import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {endiveJavaEnvironment} from './lib/endive-sdk.mjs';
test('Endive explicitly selects a JDK for Maven and the adapter and bounds Java startup',async()=>{
 const temp=await realpath(await mkdtemp(join(tmpdir(),'endive-java-')));
 try{const java=join(temp,'jdk/bin/java');await mkdir(join(temp,'jdk/bin'),{recursive:true});await writeFile(java,'fixture');
 const env={WASMFYI_ENDIVE_JAVA:java,WASMBENCH_JAVA:'/unused/java'},calls=[];
 assert.equal(await endiveJavaEnvironment(env,async(program,args,options)=>{calls.push({program,args,options});return {output:'openjdk version 25'};}),java);
 assert.equal(env.JAVA_HOME,join(temp,'jdk'));assert.equal(env.WASMBENCH_JAVA,java);assert.equal(calls.length,1);assert.equal(calls[0].program,java);assert.deepEqual(calls[0].args,['-version']);assert(calls[0].options.signal instanceof AbortSignal);
 await assert.rejects(endiveJavaEnvironment(env,async()=>{throw Error('Java failed');}),/Java failed/);
 }finally{await rm(temp,{recursive:true,force:true});}
});
