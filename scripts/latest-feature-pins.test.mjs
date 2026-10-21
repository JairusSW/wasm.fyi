import test from 'node:test';
import assert from 'node:assert/strict';
import {latestFeaturePins} from './lib/latest-feature-pins.mjs';

test('latest feature pins follow each engine release calendar independently',()=>{
 const pins=[
  {engine:'wasmtime',targetWeek:'2026-10-15T00:00:00Z',status:'planned',revision:'a'},
  {engine:'wasmtime',targetWeek:'2026-10-08T00:00:00Z',status:'planned',revision:'old-a'},
  {engine:'wago',targetWeek:'2026-10-09T00:00:00Z',status:'planned',revision:'b'},
  {engine:'wago',targetWeek:'2026-10-16T00:00:00Z',status:'unavailable'},
  {engine:'wazero',targetWeek:'2026-10-10T00:00:00Z',status:'reused',revision:'c'},
 ];
 assert.deepEqual(latestFeaturePins(pins).map(p=>[p.engine,p.revision]),[['wasmtime','a'],['wago','b'],['wazero','c']]);
});
