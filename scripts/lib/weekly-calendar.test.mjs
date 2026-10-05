import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {weeklyCutoff,weeklyPinIdentity,sharedWeeklySnapshot} from './weekly-calendar.mjs';
const calendar=JSON.parse(readFileSync(new URL('../../data/history-calendar.json',import.meta.url)));
test('both native hosts share Eastern Saturday cutoffs across daylight saving time',()=>{
 assert.equal(weeklyCutoff('2026-09-26'),'2026-09-27T03:59:00.000Z');
 assert.equal(weeklyCutoff('2026-10-03'),'2026-10-04T03:59:00.000Z');
 assert.equal(weeklyCutoff('2026-11-07'),'2026-11-08T04:59:00.000Z');
 assert.throws(()=>weeklyCutoff('2026-10-04'),/Saturday/);
});
test('source dates and pins are host independent and reject an AMD64-only date change',()=>{
 const original=calendar.weeks[0],equivalent=structuredClone(original);
 equivalent.cutoff='2026-09-26T23:59:00-04:00';equivalent.pins.reverse();
 assert.deepEqual(sharedWeeklySnapshot(original,calendar),sharedWeeklySnapshot(equivalent,calendar));
 const changed=structuredClone(original);changed.pins[0].targetWeek='2026-10-04T03:59:00Z';
 assert.throws(()=>sharedWeeklySnapshot(changed,calendar),/Engine date differs/);
 const changedSource=structuredClone(original);changedSource.pins[0].revision='a'.repeat(40);
 assert.throws(()=>sharedWeeklySnapshot(changedSource,calendar),/source pins differ/);
 assert.throws(()=>weeklyPinIdentity({...original,pins:original.pins.slice(1)}),/all six/);
});
test('an upstream that did not exist at a cutoff is the same explicit gap on both hosts',()=>{
 const entry=structuredClone(calendar.weeks[0]);entry.pins[0]={...entry.pins[0],status:'unavailable',reason:'No branch commit was available by this Saturday.'};delete entry.pins[0].revision;delete entry.pins[0].committedAt;
 const shared={...calendar,weeks:[entry]};assert.deepEqual(sharedWeeklySnapshot(entry,shared),sharedWeeklySnapshot(structuredClone(entry),shared));
});
