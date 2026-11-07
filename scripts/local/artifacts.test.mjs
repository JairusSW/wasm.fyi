import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {fetchArtifact,ensureArtifacts,artifactOrigin} from './artifacts.mjs';
const bytes=Buffer.from('0061736d01000000','hex'),w={id:'example',sha256:createHash('sha256').update(bytes).digest('hex')};
test('downloads exact bytes once, then works offline without network',async()=>{
 const cache=await mkdtemp(join(tmpdir(),'wasmfyi-download-'));let requests=0;
 try{const got=await fetchArtifact(w,{cache,fetchImpl:async url=>{requests++;assert.ok(url.endsWith(w.sha256+'.wasm'));return new Response(bytes)}});assert.deepEqual(await readFile(got.artifact),bytes);await fetchArtifact(w,{cache,offline:true,fetchImpl:()=>{throw Error('offline')}});assert.equal(requests,1)}finally{await rm(cache,{recursive:true,force:true})}
});
test('missing, broken and corrupt downloads fall back; partial files are removed',async()=>{
 const cache=await mkdtemp(join(tmpdir(),'wasmfyi-download-'));let builds=0;
 try{
  for(const fetchImpl of [async()=>new Response('',{status:404}),async()=>{throw Error('offline')},async()=>new Response('corrupt')]){const rows=await ensureArtifacts([w],{cache,fetchImpl,build:async row=>{builds++;return {...row,artifact:'built'}}});assert.equal(rows[0].artifact,'built')}
  assert.equal(builds,3);assert.deepEqual(await readdir(join(cache,'artifacts')),[]);
  assert.throws(()=>artifactOrigin('http://example.com'),/HTTPS/);assert.throws(()=>artifactOrigin('https://user:pass@example.com'),/HTTPS/);
 }finally{await rm(cache,{recursive:true,force:true})}
});
test('one download serves multiple contracts without losing their inputs',async()=>{
 const cache=await mkdtemp(join(tmpdir(),'wasmfyi-dedup-'));let requests=0;
 try{
  const rows=await ensureArtifacts([{...w,id:'a',args:[1]},{...w,id:'b',args:[2]}],{cache,fetchImpl:async()=>{requests++;return new Response(bytes)},build:()=>{throw Error('unexpected build')}});
  assert.equal(requests,1);assert.deepEqual(rows.map(w=>w.args),[[1],[2]]);assert.equal(rows[0].artifact,rows[1].artifact);
 }finally{await rm(cache,{recursive:true,force:true})}
});
