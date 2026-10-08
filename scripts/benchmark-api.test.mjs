import test from 'node:test';
import assert from 'node:assert/strict';
import {publishCapture} from './lib/benchmark-api.mjs';
const input={url:'http://localhost:8080',token:'x'.repeat(32),capture:{capturedAt:'2026-10-08T00:00:00Z',results:[]}};
test('capture publisher uses the new route and accepts a typed durable receipt',async()=>{
 const receipt=await publishCapture({...input,request:async(url,options)=>{assert.equal(url,'http://localhost:8080/api/captures');assert.equal(options.method,'POST');assert.equal(options.headers.Authorization,'Bearer '+input.token);return Response.json({id:'a'.repeat(64)})}});assert.equal(receipt.id,'a'.repeat(64));
});
test('false success cannot mark a capture published, and structured errors remain actionable',async()=>{
 for(const response of [Response.json({ok:true}),new Response('<html>shell</html>')])await assert.rejects(publishCapture({...input,request:async()=>response}),/invalid durable receipt/);
 await assert.rejects(publishCapture({...input,request:async()=>Response.json({error:{code:'invalid_request',message:'bad engine identity'}},{status:400})}),/invalid_request: bad engine identity/);
});
test('rate limiting retries the same complete capture and only accepts a durable receipt',async()=>{
 let calls=0;const bodies=[];const waits=[];
 const result=await publishCapture({...input,delay:async ms=>waits.push(ms),request:async(_url,options)=>{bodies.push(options.body);return ++calls===1?Response.json({error:{code:'rate_limit'}},{status:429,headers:{'Retry-After':'1'}}):Response.json({id:'b'.repeat(64)})}});
 assert.equal(result.id,'b'.repeat(64));assert.equal(calls,2);assert.deepEqual(waits,[1000]);assert.equal(bodies[0],bodies[1]);
});
