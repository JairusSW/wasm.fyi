import test from 'node:test';
import assert from 'node:assert/strict';
import {historySchedule,historyWeekMatches} from './lib/history-schedule.mjs';
test('weekly scheduling covers all newest engines before older weeks, including reusable hashes',()=>{
 const newest='2026-10-09T08:07:55.636Z',prior='2026-10-04T10:00:00.000Z';
 const pins=[
  {engine:'wasmtime',targetWeek:prior,status:'planned'},
  {engine:'wago',targetWeek:newest,status:'planned'},
  {engine:'wazero',targetWeek:prior,status:'reused'},
  {engine:'wasmtime',targetWeek:newest,status:'planned'},
  {engine:'wazero',targetWeek:newest,status:'planned'},
  {engine:'wago',targetWeek:'2026-06-21T10:00:00.000Z',status:'planned'},
 ];
 assert.deepEqual(historySchedule({pins},{historyNotBefore:'2026-06-28'},['wazero','wasmtime','wago']),[
  {week:newest,latest:true,engines:['wazero','wasmtime','wago']},
  {week:prior,latest:false,engines:['wazero','wasmtime']},
 ]);
});
test('runner week selection excludes every other pin and accepts equivalent UTC timestamps',()=>{
 const pin={targetWeek:'2026-10-04T10:00:00.000Z'};
 assert.equal(historyWeekMatches(pin,'2026-10-04T06:00:00-04:00'),true);
 assert.equal(historyWeekMatches(pin,'2026-09-27T10:00:00Z'),false);
 assert.equal(historyWeekMatches(pin,undefined),true);
 assert.throws(()=>historyWeekMatches(pin,'broken'),/Invalid/);
});
