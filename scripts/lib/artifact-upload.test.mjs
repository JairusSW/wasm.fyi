import test from 'node:test';
import assert from 'node:assert/strict';
import {artifactUpload} from './artifact-upload.mjs';
test('large artifact publications respect throttling and retry idempotent writes',async()=>{
 let calls=0;const waits=[];
 await artifactUpload('https://example.test/api/artifacts',{method:'POST',body:'contract'},{request:async(_url,options)=>{assert.equal(options.method,'POST');assert.equal(options.body,'contract');return ++calls<3?new Response('',{status:429,headers:{'Retry-After':'1'}}):new Response('{}',{status:201})},delay:async ms=>waits.push(ms)});
 assert.equal(calls,3);assert.deepEqual(waits,[1000,1000]);
 await assert.rejects(()=>artifactUpload('https://example.test/api/artifacts',{}, {request:async()=>new Response('',{status:401})}),/HTTP 401/);
});
