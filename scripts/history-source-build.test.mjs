import test from 'node:test';
import assert from 'node:assert/strict';
import {needsHistoricalSourceBuild} from './lib/history-source-build.mjs';

test('new SDK release integrations build the exact release commit', () => {
  for (const engine of ['wasmer','wazy','endive','chasm','wizard','graalwasm','zwasm']) {
    const pin = {engine,targetType:'release',tag:'v1.2.3',revision:'a'.repeat(40),dateBasis:'release-published'};
    assert.equal(needsHistoricalSourceBuild(pin),true);
    assert.equal(pin.targetType,'release');
    assert.equal(pin.tag,'v1.2.3');
    assert.throws(() => needsHistoricalSourceBuild({...pin,revision:'abcdef0'}),/full commit hash/);
    assert.throws(() => needsHistoricalSourceBuild({...pin,revision:undefined}),/full commit hash/);
  }
});

test('existing archive bindings and source snapshots retain their build routes', () => {
  assert.equal(needsHistoricalSourceBuild({engine:'wasmtime',targetType:'release'}),false);
  assert.equal(needsHistoricalSourceBuild({engine:'wasmtime',targetType:'main'}),true);
  assert.equal(needsHistoricalSourceBuild({engine:'wasmtime',targetType:'release',dateBasis:'git-tag-commit'}),true);
});
