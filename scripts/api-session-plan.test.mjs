import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareSessionPlan} from './lib/api-session-plan.mjs';
import {planIdentity,lockedPlanBytes} from './lib/benchmark-plan.mjs';
import {digest} from './lib/wasmbench.mjs';
function fixture(){
 const plan={schema:1,id:'before-first-job',created:'2026-10-06',configuredHarnessPin:'0509a0a323f41c58a2f2db15a372fb2e63c692bf',machines:[{name:'local'},{name:'hub'}],jobs:[{id:'corpus-0001'},{id:'corpus-0002'}],note:'<λ>'.repeat(400000)};
 plan.identity=planIdentity(plan);return plan;
}
test('registration preparation preserves exact locked bytes without any completed job',()=>{
 const plan=fixture(),{registration,objects}=prepareSessionPlan(plan);
 assert.equal(registration.session,plan.id);assert.equal(registration.plan,plan.identity);
 assert(!('exports' in registration));assert(!('attempt' in registration));assert(!('machine' in registration));
 const bytes=Buffer.concat(objects.map(o=>o.body));assert(bytes.equals(lockedPlanBytes(plan)));assert.equal(digest(bytes),plan.identity);assert(objects.length>1);
 assert.equal(registration.sessionPlan.bytes,bytes.length);
 for(const [i,o] of objects.entries()){assert.equal(digest(o.body),o.sha256);assert.equal(o.bytes,o.body.length);assert(o.bytes<=1024*1024);if(i<objects.length-1)assert.equal(o.bytes,1024*1024);assert(!('body' in registration.sessionPlan.chunks[i]));}
});
test('registration preparation rejects scope drift, duplicates, malformed identities and cancellation',()=>{
 const plan=fixture();
 for(const mutate of [p=>p.jobs.push({id:'new'}),p=>p.machines.push({name:'local'}),p=>p.jobs.push({id:'corpus-0001'}),p=>delete p.id,p=>p.id='../escape',p=>p.configuredHarnessPin='short',p=>p.jobs=[]]){
  const bad=structuredClone(plan);mutate(bad);assert.throws(()=>prepareSessionPlan(bad));
 }
 const bad=fixture();bad.machines=Array.from({length:128},(_,i)=>({name:'m'+i}));bad.jobs=Array.from({length:782},(_,i)=>({id:'c'+i}));bad.identity=planIdentity(bad);assert.throws(()=>prepareSessionPlan(bad),/scope exceeds/);
 const controller=new AbortController();controller.abort();assert.throws(()=>prepareSessionPlan(plan,{signal:controller.signal}),{name:'AbortError'});
});
