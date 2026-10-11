import test from 'node:test';
import assert from 'node:assert/strict';
import {configureGraalJava,ensureGraalDriver,graalMxRevision,upgradeGraalRuntimeExports,upgradeGraalRuntimeArguments} from './lib/graalwasm-sdk.mjs';
import {execFileSync} from 'node:child_process';

test('Graal launcher avoids synchronous JVMCI bootstrap on Darwin while retaining Linux policy',()=>{
 const original='def wasmfyi_runtime_configuration(args):\n    vm_args = ["--enable-native-access=ALL-UNNAMED", "-XX:ActiveProcessorCount=1", "-XX:+UseSerialGC", "-Xbatch"]\n    return vm_args\n';
 const upgraded=upgradeGraalRuntimeArguments(original);
 assert.equal(upgradeGraalRuntimeArguments(upgraded),upgraded);
 for(const platform of ['darwin','linux']){
  const args=JSON.parse(execFileSync('python3',['-c','import sys,json\nsys.platform='+JSON.stringify(platform)+'\n'+upgraded+'\nprint(json.dumps(wasmfyi_runtime_configuration([])))']).toString());
  assert.equal(args.includes('-Xbatch'),platform!=='darwin');
  assert.ok(args.includes('-XX:ActiveProcessorCount=1'));assert.ok(args.includes('-XX:+UseSerialGC'));
 }
 assert.equal(upgradeGraalRuntimeArguments('unmodified upstream source'),'unmodified upstream source');
 assert.throws(()=>upgradeGraalRuntimeArguments('def wasmfyi_runtime_configuration(args): pass'),/argument extension changed/);
});

test('existing source extension gains executable API access exactly once',()=>{
 const original='def wasmfyi_runtime_configuration(args):\n    for package in ["org.graalvm.wasm", "org.graalvm.wasm.memory", "org.graalvm.wasm.predefined"]:\n        pass\n';
 const upgraded=upgradeGraalRuntimeExports(original);
 assert.ok(upgraded.includes('"org.graalvm.wasm.api"'));
 assert.equal(upgradeGraalRuntimeExports(upgraded),upgraded);
 assert.equal(upgradeGraalRuntimeExports('unmodified upstream source'),'unmodified upstream source');
 assert.throws(()=>upgradeGraalRuntimeExports('def wasmfyi_runtime_configuration(args): pass'),/extension changed/);
});

test('generic Java for other runtimes cannot override Graal JVMCI selection',()=>{
 const env={WASMBENCH_JAVA:'/jdk/temurin/bin/java',JAVA_HOME:'/jdk/temurin',PATH:'/jdk/temurin/bin:/usr/bin'};
 configureGraalJava(env);
 assert.equal(env.JAVA_HOME,undefined);
 assert.equal(env.WASMBENCH_JAVA,'/jdk/temurin/bin/java');
 assert.equal(env.PATH,'/jdk/temurin/bin:/usr/bin');
 const dedicated={...env,WASMFYI_GRAAL_JAVA:'/jdk/labs/bin/java'};
 configureGraalJava(dedicated);
 assert.equal(dedicated.JAVA_HOME,'/jdk/labs');
});
test('qualified cached mx driver requires no fetch or checkout',async()=>{
 const calls=[];
 const revision=await ensureGraalDriver('/cache/mx',async(binary,args)=>{calls.push([binary,args]);return {output:graalMxRevision+'\n'};});
 assert.equal(revision,graalMxRevision);
 assert.equal(calls.length,1);
});
test('mx migration preserves locally modified tracked source',async()=>{
 const calls=[];
 await assert.rejects(ensureGraalDriver('/cache/mx',async(binary,args)=>{
  calls.push(args);return {output:args.includes('rev-parse')?'previous-revision\n':' M mx.py\n'};
 }),/local tracked changes/);
 assert.equal(calls.length,2);
 assert.ok(calls.every(args=>!args.includes('fetch')&&!args.includes('checkout')));
});
