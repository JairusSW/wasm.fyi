import test from 'node:test';
import assert from 'node:assert/strict';
import {graalOptionDiscoveryArguments,configureGraalJava,configureGraalFeatureOptions,ensureGraalDriver,graalMxRevision,upgradeGraalRuntimeExports,upgradeGraalRuntimeArguments} from './lib/graalwasm-sdk.mjs';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

const adapter=readFileSync(new URL('../adapters/qualification/GraalWasmAdapter.java',import.meta.url),'utf8');
const required=['wasm.EvalReturnsInstance','wasm.UseUnsafeMemory','wasm.AsyncParsingBinarySize'];
test('Graal feature options omit unavailable historical switches from the actual adapter',()=>{
 const result=configureGraalFeatureOptions(adapter,[...required,'wasm.Memory64','wasm.Threads','wasm.SIMD'],[]);
 assert.deepEqual(result.enabled,['Memory64','Threads','SIMD']);
 assert.ok(result.unavailable.includes('TailCalls'));
 assert.equal(result.adapter.includes('"TailCalls"'),false);
 assert.ok(result.adapter.includes('.option("wasm.UseUnsafeMemory","true")'));
 assert.ok(result.adapter.includes('for(String option:FEATURE_OPTIONS)'));
 assert.ok(result.adapter.includes('ENGINE_OPTIONS=Map.of()'));
});
test('Graal feature options preserve modern configuration and never enable unrequested switches',()=>{
 const features=['Memory64','MultiMemory','WideArithmetic','Threads','ExtendedConstExpressions','SIMD','RelaxedSIMD','Exceptions','LegacyExceptions','TypedFunctionReferences','GC','TailCalls'];
 const engine=['engine.BackgroundCompilation','engine.CompileImmediately','engine.MultiTier'];
 const result=configureGraalFeatureOptions(adapter,[...required,...features.map(name=>'wasm.'+name),'wasm.UnrequestedFeature'],engine);
 assert.equal(result.adapter,adapter);
 assert.deepEqual(result.enabled,features);
 assert.deepEqual(result.unavailable,[]);
 assert.deepEqual(result.engineOptions,{BackgroundCompilation:'false',CompileImmediately:'true',MultiTier:'false'});
});
test('Graal feature options keep required measurement controls strict',()=>{
 assert.throws(()=>configureGraalFeatureOptions(adapter,['wasm.SIMD']),/required measurement option/);
 assert.throws(()=>configureGraalFeatureOptions(adapter,[...required,42]),/Invalid Graal Wasm option descriptors/);
 assert.throws(()=>configureGraalFeatureOptions(adapter.replace('FEATURE_OPTIONS=','RENAMED='),required),/declaration changed/);
 assert.throws(()=>configureGraalFeatureOptions(adapter,required,[42]),/Invalid Graal engine option descriptors/);
 assert.throws(()=>configureGraalFeatureOptions(adapter.replace('ENGINE_OPTIONS=','RENAMED_ENGINE_OPTIONS='),required),/engine option declaration changed/);
});

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

// Discovery enumerates descriptors without compiling or executing a workload.
test('option discovery avoids JVMCI bootstrap without weakening benchmark arguments',()=>{
 const runtime=Object.freeze(['--enable-native-access=ALL-UNNAMED','-XX:ActiveProcessorCount=1','-Xbatch']);
 const discovery=graalOptionDiscoveryArguments(runtime);
 assert.deepEqual(discovery.slice(0,runtime.length),runtime);
 assert.ok(discovery.includes('-XX:+EnableJVMCI'));
 assert.ok(discovery.includes('-XX:-UseJVMCICompiler'));
 assert.equal(runtime.includes('-XX:-UseJVMCICompiler'),false);
 assert.equal(runtime.includes('-Xint'),false);
});
