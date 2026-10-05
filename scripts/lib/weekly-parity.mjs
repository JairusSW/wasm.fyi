import assert from 'node:assert/strict';
import {digest} from './wasmbench.mjs';
import {performanceCorpusIdentity} from './performance-history.mjs';
import {sharedWeeklySnapshot} from './weekly-calendar.mjs';

export function assertCaptureParity(plan,receipt,calendar) {
 const snapshot=sharedWeeklySnapshot({...receipt.pin,cutoff:receipt.pin.targetWeek,zone:calendar.zone,pins:calendar.weeks.find(w=>new Date(w.cutoff).toISOString()===new Date(receipt.pin.targetWeek).toISOString())?.pins},calendar);
 const week=calendar.weeks.find(w=>w.date===snapshot.date),capture=week.capture;
 const pin=week.pins.find(p=>p.engine===receipt.pin.engine);
 assert(pin && pin.revision===receipt.pin.revision && pin.repository===receipt.pin.repository,'Capture source differs from shared source pin');
 assert.deepEqual(receipt.pin.configurations,pin.configurations,'Capture compiler configurations differ');
 assert.equal(plan.sourcePin.revision,pin.revision,'Capture plan source differs');
 assert.equal(new Date(plan.sourcePin.targetWeek).toISOString(),snapshot.cutoff,'Capture plan date differs');
 assert(capture,'Shared week has no frozen capture recipe');
 const {runtimes,...collection}=plan.collection;
 assert.deepEqual(collection,capture.collection,'Host measurement settings differ from shared recipe');
 assert.deepEqual(runtimes,receipt.pin.configurations,'Host compiler configuration differs');
 assert.equal(receipt.harnessRevision,capture.harnessRevision,'Host harness revision differs');
 assert.equal(plan.machines[0].workers,capture.workers,'Host worker ratio differs');
 assert.equal(performanceCorpusIdentity(plan.jobs.flatMap(j=>j.workloads)),capture.corpusSha256,'Host corpus artifacts or contracts differ');
 assert.equal(plan.jobs.length,capture.corpora,'Host corpus grouping differs');
 return {corpusSha256:capture.corpusSha256,recipeSha256:digest(JSON.stringify(capture)),harnessRevision:capture.harnessRevision};
}

// Gate site publication: a weekly point must have matched source identities on
// both hosts. Measurement values and failure outcomes remain host specific.
export function assertWeeklyParity(arm,amd,calendar,{requireComplete=false}={}) {
 const dates=timeline=>timeline.results.map(p=>new Date(p.targetWeek).toISOString()).sort();
 if(requireComplete)assert.deepEqual(dates(arm),dates(amd),'ARM64 and AMD64 historical dates differ; finish both hosts before publishing');
 const checks=[];
 for(const week of calendar.weeks){
  const cutoff=new Date(week.cutoff).toISOString();
  const points=[arm,amd].map(t=>t.results.find(p=>new Date(p.targetWeek).toISOString()===cutoff));
  if(points.every(p=>!p))continue;
  if(requireComplete)assert(points.every(Boolean),'Historical week missing on a host');
  for(const pin of week.pins)for(const [i,point] of points.entries()){
   if(!point)continue; // A faster host may advance; the common chart inserts a gap.
   const value=point.engines?.[pin.configurations[0]];
   if(pin.status==='unavailable'){
    assert(!value && point.gaps?.[pin.configurations[0]]?.source.status==='unavailable','Unavailable upstream must remain an explicit gap');
    const gap=point.gaps[pin.configurations[0]];assert.equal(gap.source.repository,pin.repository,'Upstream gap repository differs');assert.equal(new Date(gap.source.targetWeek).toISOString(),cutoff,'Upstream gap date differs');continue;
   }
   if(!value && ['pending','build-failed','qualification-failed'].includes(point.gaps?.[pin.configurations[0]]?.type)){
    if(point.gaps[pin.configurations[0]].type==='pending')assert(!requireComplete,'Incomplete paired week: '+week.date+'/'+pin.engine);
    const gap=point.gaps[pin.configurations[0]];assert.equal(gap.source.revision,pin.revision,'Build gap source hash differs');assert.equal(new Date(gap.source.targetWeek).toISOString(),cutoff,'Build gap date differs');assert(gap.reason,'Build gap needs a reason');assert.deepEqual(gap.parity,{corpusSha256:week.capture.corpusSha256,recipeSha256:digest(JSON.stringify(week.capture)),harnessRevision:week.capture.harnessRevision},'Build gap capture recipe differs');continue;
   }
   assert(value?.status==='measured' && value.reports?.length,'Incomplete paired week: '+week.date+'/'+pin.engine+'/'+(i?'amd64':'arm64'));
   assert.equal(value.revision,pin.revision,'Historical source hash differs from shared pin');
   assert.equal(value.source?.repository,pin.repository,'Historical source repository differs');
   assert.equal(new Date(value.source.targetWeek).toISOString(),cutoff,'Historical source date differs');
   assert.deepEqual(value.parity,{corpusSha256:week.capture.corpusSha256,recipeSha256:digest(JSON.stringify(week.capture)),harnessRevision:week.capture.harnessRevision},'Historical capture differs from shared recipe');
  }
  checks.push({date:week.date,cutoff,engines:week.pins.length,hosts:points.map(p=>p?'measured':'pending')});
 }
 return checks;
}
