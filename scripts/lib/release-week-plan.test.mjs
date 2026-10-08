import {test} from 'node:test';import assert from 'node:assert/strict';
import {releaseWeekPlan} from './release-week-plan.mjs';
const main=(revision,targetWeek)=>({engine:'wago',targetType:'main',revision,targetWeek,status:'planned',configurations:['wago']});
const release=(tag,revision,targetWeek)=>({...main(revision,targetWeek),targetType:'release',tag});
test('uses releases during their Eastern week, falls back to main, and does not repeat commits',()=>{
 const p=releaseWeekPlan({anchor:'2026-10-08T06:21:36.206Z',pins:[release('v0.1.0-beta.12','a','2026-10-01T12:00:00Z'),release('v0.1.0-beta.11','a','2026-09-29T12:00:00Z'),main('b','2026-10-04T03:59:00Z'),main('c','2026-09-27T03:59:00Z'),release('v0.1.0-canary.gabcdef0','d','2026-09-15T12:00:00Z'),main('old','2026-07-05T03:59:00Z')]});
 assert.deepEqual(p.pins.filter(p=>p.status==='planned').map(p=>p.revision),['a','c']);
 assert.equal(p.samples,5);assert.equal(p.cutoff,'2026-07-08T06:21:36.206Z');
});
