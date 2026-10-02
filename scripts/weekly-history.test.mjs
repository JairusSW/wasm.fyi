import test from 'node:test';import assert from 'node:assert/strict';
import {wednesdays,snapshotKey} from './lib/weekly-history.mjs';
import {engineSources} from './lib/engine-sources.mjs';
test('Wednesday boundaries are UTC, include the latest Wednesday and catch every missed week',()=>{
  assert.deepEqual(wednesdays(new Date('2026-10-01T19:00:00Z'),2),['2026-09-23T00:00:00.000Z','2026-09-30T00:00:00.000Z']);
  assert.equal(wednesdays(new Date('2026-09-30T23:59:59Z'),1)[0],'2026-09-30T00:00:00.000Z');
  assert.equal(wednesdays(new Date('2026-09-29T23:59:59Z'),1)[0],'2026-09-23T00:00:00.000Z');
  const dates=wednesdays(new Date('2026-10-15T00:00:00Z'),2,[{targetWeek:'2026-09-23T00:00:00Z'}]);
  assert.equal(dates.length,4);assert(dates.every(d=>new Date(d).getUTCDay()===3));
});
test('reuse identity includes source, host, corpus, recipe, options and configuration',()=>{
  const input={engine:'wago',revision:'a'.repeat(40),suiteSha256:'b'.repeat(64),recipeSha256:'c'.repeat(64),host:'darwin/arm64',configurations:['wago'],options:{samples:3}};
  for(const key of Object.keys(input))assert.notEqual(snapshotKey(input),snapshotKey({...input,[key]:'changed'}));
});
test('all fourteen engines have explicit release sources and configurations',()=>{
  assert.equal(Object.keys(engineSources).length,14);
  for(const source of Object.values(engineSources)){assert(source.repository.includes('/'));assert(!source.branch);assert(source.configurations.length);}
});
test('a full year includes both Wednesday endpoints, 52 weekly intervals',()=>{
 const dates=wednesdays(new Date('2026-10-02T00:00:00Z'),53);
 assert.equal(dates.length,53);assert.equal(dates[0],'2025-10-01T00:00:00.000Z');assert.equal(dates.at(-1),'2026-09-30T00:00:00.000Z');
});
