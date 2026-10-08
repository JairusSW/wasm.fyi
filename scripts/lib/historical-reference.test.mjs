import {test} from 'node:test';
import assert from 'node:assert/strict';
import {historicalWorkload,historicalReference} from './historical-reference.mjs';

test('retired historical contracts preserve their recorded ABI, digest and category',()=>{
 const archived={id:'applications/retired-cli',sha256:'old',abi:'wasi-preview1',provenance:{category:'Text & parsing'}};
 assert.deepEqual(historicalWorkload(archived),{id:archived.id,artifactSha256:'old',abi:'wasi-preview1',group:'Text & parsing'});
});
test('projection passes only pinned baseline IDs and digests to canonical evidence selection',()=>{
 const archived={id:'applications/retired-cli',sha256:'old',abi:'wasi-preview1',provenance:{category:'Text & parsing'}};
 const projected=historicalReference([archived],workloads=>{
  assert.deepEqual(workloads,[historicalWorkload(archived)]);
  return {s1:{[archived.id+'|D|steady']:{st:'ok',v:8,report:'sealed-wasi-release'}}};
 });
 assert.deepEqual(projected.workloads,[archived.id]);
 assert.deepEqual(projected.artifactSha256,{[archived.id]:'old'});
 assert.equal(projected.referenceCells[archived.id+'|D|steady'].report,'sealed-wasi-release');
 assert.equal(projected.referenceCells['applications/replacement|D|steady'],undefined);
});
