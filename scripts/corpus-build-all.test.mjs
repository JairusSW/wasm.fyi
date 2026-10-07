import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCorpusFromSource } from './corpus-build-all.mjs';

test('complete source build resolves the pinned harness before the final audit',async()=>{
  const calls=[],settings={harnessSource:{revision:'pinned-source'}},env={PATH:'/tools'};
  await buildCorpusFromSource({env,loadSettings:async()=>settings,
    resolveHarness:async value=>{assert.equal(value,settings);calls.push(['resolve']);return '/fresh/harness';},
    run:async(script,args,environment)=>calls.push([script,args,environment])});
  assert.deepEqual(calls.map(c=>c[0]),['wasi-sdk-toolchain.mjs','application-corpus.mjs','feature-corpus.mjs','corpus-rebuild.mjs','corpus-v8.mjs','corpus-components-check.mjs','resolve','corpus-audit.mjs']);
  assert.deepEqual(calls[4][1],['--from-source']);
  assert.deepEqual(calls.at(-1)[2],{PATH:'/tools',WASMBENCH_ROOT:'/fresh/harness'});
  assert.deepEqual(env,{PATH:'/tools'});
});

test('a failed source stage prevents harness preparation and final publication',async()=>{
  const calls=[];
  await assert.rejects(buildCorpusFromSource({
    run:async script=>{calls.push(script);if(script==='corpus-rebuild.mjs')throw Error('source build failed');},
    resolveHarness:async()=>{throw Error('must not resolve after failure');}
  }),/source build failed/);
  assert.equal(calls.at(-1),'corpus-rebuild.mjs');
  assert(!calls.includes('corpus-audit.mjs'));
});

test('harness source preparation failures prevent the final audit',async()=>{
  const calls=[];
  await assert.rejects(buildCorpusFromSource({loadSettings:async()=>({}),
    run:async script=>calls.push(script),resolveHarness:async()=>{throw Error('source unavailable');}
  }),/source unavailable/);
  assert(!calls.includes('corpus-audit.mjs'));
});
