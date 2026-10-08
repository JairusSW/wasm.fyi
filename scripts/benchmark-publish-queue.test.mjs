import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicationQueue} from './lib/benchmark-publish-queue.mjs';
test('refreshes live immediately and batches reports arriving during a refresh',async()=>{
 let release;const gate=new Promise(r=>release=r),batches=[];
 const queue=publicationQueue(async items=>{batches.push(items);if(batches.length===1)await gate;},e=>{throw e;});
 queue.push(1);queue.push(2);queue.push(3);assert.deepEqual(batches,[[1]]);
 release();await queue.drain();assert.deepEqual(batches,[[1],[2,3]]);
 queue.push(4);await queue.drain();assert.deepEqual(batches,[[1],[2,3],[4]]);
});
test('propagates a publication failure without starting another batch',async()=>{
 const failure=new Error('unverified report');let observed,calls=0;
 const queue=publicationQueue(async()=>{calls++;throw failure;},e=>observed=e);
 queue.push(1);queue.push(2);await assert.rejects(queue.drain(),e=>e===failure);
 assert.equal(observed,failure);assert.equal(calls,1);
});
