import test from 'node:test';
import assert from 'node:assert/strict';
import {newWeeklyPlan,planWeeklyEngine} from './lib/weekly-source-plan.mjs';
const sha=letter=>letter.repeat(40);
const spec={repository:'example/engine',configurations:['compiler','interpreter']};
const commit=(letter,date)=>({sha:sha(letter),commit:{committer:{date}}});
const calendar={anchor:'2026-10-11T10:00:00Z',cutoff:'2026-04-11T10:00:00Z',weeks:[{start:'2026-10-04T10:00:00Z',end:'2026-10-11T10:00:00Z'},{start:'2026-09-27T10:00:00Z',end:'2026-10-04T10:00:00Z'}]};
test('release week and default-branch week sharing a commit only measure once',async()=>{
 const release={tag_name:'v1',published_at:'2026-10-07T00:00:00Z'};
 const upstream={releases:async()=>[release],defaultBranch:async()=> 'main',releaseRevision:async()=>sha('a'),commits:async()=>[commit('a','2026-10-03T00:00:00Z')]};
 const rows=await planWeeklyEngine('engine',spec,calendar,upstream);
 assert.equal(rows[0].targetType,'release');assert.equal(rows[0].revision,sha('a'));
 assert.equal(rows[1].targetType,'main');assert.equal(rows[1].status,'reused');assert.equal(rows[1].reuseTargetWeek,rows[0].targetWeek);
});
test('chooses the nearest commit after Sunday and requests the bounded later window',async()=>{
 const week=calendar.weeks[0];let since;
 const upstream={releases:async()=>[],defaultBranch:async()=> 'main',commits:async(repo,branch,until,count,start)=>{since=start||since;return count===1?[commit('a','2026-10-10T10:00:00Z')]:[commit('b','2026-10-11T11:00:00Z')];}};
 const rows=await planWeeklyEngine('engine',spec,{...calendar,anchor:'2026-10-12T10:00:00Z',weeks:[week]},upstream);
 assert.equal(rows[0].revision,sha('b'));assert.equal(since,week.end);
});
test('never substitutes main for a release whose provenance cannot be resolved',async()=>{
 const upstream={releases:async()=>[{tag_name:'v1',published_at:'2026-10-07'}],defaultBranch:async()=> 'main',releaseRevision:async()=>{throw Error('Missing release tag');},commits:async()=>{throw Error('Must not silently fall back');}};
 const [row]=await planWeeklyEngine('engine',spec,{...calendar,weeks:[calendar.weeks[0]]},upstream);
 assert.equal(row.status,'unavailable');assert.match(row.reason,/Missing release tag/);
});
test('all three hosts share the frozen six-month window',()=>{
 const plan=newWeeklyPlan('2026-10-09T12:00:00Z');assert.equal(plan.cutoff,'2026-04-09T12:00:00.000Z');assert.deepEqual(plan.machines,['local-arm64','hub-amd64','remote-amd64']);
});
test('a dormant project keeps its prior source even when it predates the snapshot window',async()=>{
 const upstream={releases:async()=>[],defaultBranch:async()=> 'main',commits:async(repo,branch,until,count)=>count===1?[commit('a','2026-03-01T00:00:00Z')]:[]};
 const rows=await planWeeklyEngine('engine',spec,calendar,upstream);
 assert.equal(rows[0].revision,sha('a'));assert.equal(rows[0].status,'planned');
 assert.equal(rows[1].revision,sha('a'));assert.equal(rows[1].status,'reused');
});
test('an existing dormant project searches later commits for the closest weekly source',async()=>{
 const upstream={releases:async()=>[],defaultBranch:async()=> 'main',commits:async(repo,branch,until,count)=>count===1?[commit('a','2025-09-30T22:41:28Z')]:[commit('b','2026-08-01T02:19:51Z')]};
 const week={start:'2026-07-19T10:00:00Z',end:'2026-07-26T10:00:00Z'};
 const [row]=await planWeeklyEngine('engine',spec,{...calendar,weeks:[week]},upstream);
 assert.equal(row.revision,sha('b'));assert.equal(row.status,'planned');
});
test('weekly fallback still stops before project creation and at sources older than a year',async()=>{
 for(const prior of [undefined,commit('a','2024-01-01T00:00:00Z')]){
  const upstream={releases:async()=>[],defaultBranch:async()=> 'main',commits:async(repo,branch,until,count)=>count===1?(prior?[prior]:[]):[commit('b','2026-10-11T11:00:00Z')]};
  const [row]=await planWeeklyEngine('engine',spec,{...calendar,weeks:[calendar.weeks[0]]},upstream);
  assert.equal(row.status,'unavailable');
 }
});
