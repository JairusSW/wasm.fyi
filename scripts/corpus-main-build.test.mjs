import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMainCorpus } from './corpus-main-build.mjs';
test('main-only build compiles all application sources and checks imports before execution and audit',async()=>{
  const calls=[];
  await buildMainCorpus({env:{PATH:'/tools'},loadSettings:async()=>({corpus:{buildManifest:'source.json'}}),
    run:async(...args)=>calls.push(args)});
  assert.deepEqual(calls.map(c=>c[0]),['wasi-sdk-toolchain.mjs','application-corpus.mjs','corpus-rebuild.mjs','main-corpus-check.mjs','corpus-v8.mjs','corpus-audit.mjs']);
  assert.deepEqual(calls[4][1],['--suite-only','source.json']);
  assert.deepEqual(calls.at(-1)[1],['--main-only']);
  assert.deepEqual(calls.at(-1)[2],{PATH:'/tools'});
  assert(!calls.some(c=>c[0].startsWith('feature-')));
});
test('failed core admission cannot publish a refreshed application catalog',async()=>{
  const calls=[];
  await assert.rejects(buildMainCorpus({loadSettings:async()=>({corpus:{buildManifest:'source.json'}}),
    run:async(script)=>{calls.push(script);if(script==='main-corpus-check.mjs')throw Error('forbidden import');}}),/forbidden import/);
  assert.equal(calls.at(-1),'main-corpus-check.mjs');
});
