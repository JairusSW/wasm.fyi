import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {digest} from './wasmbench.mjs';
import {assertCaptureParity,assertWeeklyParity} from './weekly-parity.mjs';
const calendar=JSON.parse(readFileSync(new URL('../../data/history-calendar.json',import.meta.url)));
const week=calendar.weeks.find(w=>w.date==='2026-09-26');
const timeline=()=>({results:[{targetWeek:week.cutoff,engines:Object.fromEntries(week.pins.map(pin=>[pin.configurations[0],{status:'measured',revision:pin.revision,source:pin,parity:{corpusSha256:week.capture.corpusSha256,recipeSha256:digest(JSON.stringify(week.capture)),harnessRevision:week.capture.harnessRevision},reports:[{runId:pin.engine}]}]))}]});
test('paired publication rejects missing weeks, engines, source dates and revisions',()=>{
 const arm=timeline(),amd=timeline();assert.equal(assertWeeklyParity(arm,amd,calendar).length,1);
 assert.throws(()=>assertWeeklyParity(arm,{results:[]},calendar,{requireComplete:true}),/dates differ/);
 assert.equal(assertWeeklyParity(arm,{results:[]},calendar)[0].hosts[1],'pending');
 delete amd.results[0].engines.v8;assert.throws(()=>assertWeeklyParity(arm,amd,calendar),/Incomplete paired week/);
 const changed=timeline();changed.results[0].engines.wago.revision='a'.repeat(40);
 assert.throws(()=>assertWeeklyParity(arm,changed,calendar),/source hash differs/);
 const wrongDate=timeline();wrongDate.results[0].engines.wago.source={...week.pins[0],targetWeek:calendar.weeks.find(w=>w.date==='2026-10-03').cutoff};
 assert.throws(()=>assertWeeklyParity(arm,wrongDate,calendar),/source date differs/);
});
test('capture parity rejects a host changing samples before any measurement',()=>{
 const pin=week.pins[0],receipt={pin,harnessRevision:week.capture.harnessRevision};
 const plan={sourcePin:pin,collection:{...week.capture.collection,runtimes:pin.configurations,samples:999},machines:[{workers:'25%'}],jobs:[]};
 assert.throws(()=>assertCaptureParity(plan,receipt,calendar),/measurement settings differ/);
});
