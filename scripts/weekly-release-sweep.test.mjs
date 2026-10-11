import test from 'node:test';
import assert from 'node:assert/strict';
import {sweepWeeks,releaseInWeek,deduplicateSweep} from './lib/weekly-release-sweep.mjs';

test('six-month intervals cover the complete window without gaps',()=>{
 const plan=sweepWeeks('2026-10-09T12:00:00Z');
 assert.equal(plan.cutoff,'2026-04-09T12:00:00.000Z');
 assert.equal(plan.weeks[0].end,plan.anchor);
 assert.equal(plan.weeks.at(-1).start,plan.cutoff);
 for(let i=1;i<plan.weeks.length;i++)assert.equal(plan.weeks[i].end,plan.weeks[i-1].start);
 assert.equal(plan.weeks[0].start,'2026-10-04T10:00:00.000Z');
});
test('Sunday morning follows the Eastern daylight-saving transition',()=>{
 const {weeks}=sweepWeeks('2026-11-09T12:00:00Z',1);
 assert(weeks.some(w=>w.start==='2026-11-01T11:00:00.000Z'));
 assert(weeks.some(w=>w.start==='2026-10-25T10:00:00.000Z'));
});
test('only this week releases qualify; Wago betas are included',()=>{
 const week={start:'2026-10-04T10:00:00Z',end:'2026-10-09T12:00:00Z'};
 const old={tag_name:'v1.0.0',published_at:week.start};
 const beta={tag_name:'v2.0.0-beta.12',published_at:'2026-10-05T12:00:00Z',prerelease:true};
 assert.equal(releaseInWeek('wago',[old,beta],week),beta);
 assert.equal(releaseInWeek('wasmtime',[old,beta],week),null);
});
test('aliases to the same commit are measured once per backend set',()=>{
 const pin={engine:'wago',revision:'a'.repeat(40),configurations:['wago'],status:'planned'};
 const rows=deduplicateSweep([{...pin,targetWeek:'new'},{...pin,targetWeek:'old'}]);
 assert.equal(rows[1].status,'reused');assert.equal(rows[1].reuseTargetWeek,'new');
});
