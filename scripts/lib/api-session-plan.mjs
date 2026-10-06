import assert from 'node:assert/strict';
import {lockedPlanBytes} from './benchmark-plan.mjs';
import {digest} from './wasmbench.mjs';
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const HASH=/^[a-f0-9]{64}$/;
const PIN=/^[a-f0-9]{40}$/;
// Shared by completed-job publication and pre-job registration. Preparing a
// scope performs no HTTP writes and requires no attempt or measurement export.
export function prepareSessionPlan(plan,{signal}={}){
  signal?.throwIfAborted();
  assert(plan.schema===1&&typeof plan.id==='string'&&ID.test(plan.id)&&HASH.test(plan.identity)&&PIN.test(plan.configuredHarnessPin),'Invalid session plan registration');
  const validateNames=(values,field,limit)=>{
    assert(Array.isArray(values)&&values.length>0&&values.length<=limit,'Invalid session plan scope');
    const names=new Set();
    for(const item of values){signal?.throwIfAborted();assert(item&&typeof item[field]==='string'&&ID.test(item[field])&&!names.has(item[field]),'Invalid or duplicate session plan member');names.add(item[field]);}
  };
  validateNames(plan.machines,'name',128);validateNames(plan.jobs,'id',10000);
  assert(plan.machines.length*plan.jobs.length<=100000,'Session plan scope exceeds ceiling');
  const raw=lockedPlanBytes(plan);
  assert(raw.length>0&&raw.length<=16*1024*1024&&digest(raw)===plan.identity,'Session plan differs from locked identity or exceeds ceiling');
  signal?.throwIfAborted();
  const sessionPlan={schema:1,bytes:raw.length,chunks:[]},objects=[];
  for(let offset=0;offset<raw.length;offset+=1024*1024){
    signal?.throwIfAborted();
    const body=raw.subarray(offset,offset+1024*1024),object={sha256:digest(body),bytes:body.length,kind:'binary'};
    sessionPlan.chunks.push(object);objects.push({...object,body});
  }
  return {registration:{schema:1,session:plan.id,plan:plan.identity,configuredHarnessPin:plan.configuredHarnessPin,sessionPlan},objects};
}
