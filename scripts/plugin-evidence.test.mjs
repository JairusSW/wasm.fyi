import test from 'node:test';
import assert from 'node:assert/strict';
import {pluginEvidence} from './lib/plugin-evidence.mjs';
test('plugin cells retain package scope and exclude other hosts and runner errors',()=>{
  const host={hostname:'mac.local',os:'darwin',arch:'arm64'};
  const lane={id:'wago-wasi-library',status:'passed',totals:{passed:3,failed:0,skipped:1},engine:{tag:'v1'},plugin:{tag:'v2'},stdout:[
    {Package:'github.com/wago-org/wasi/p1',Test:'P1',Action:'pass'},
    {Package:'github.com/wago-org/wasi/p2',Test:'P2',Action:'pass'},
    {Package:'github.com/wago-org/wasi/p2',Test:'P2/A',Action:'pass'},
    {Package:'github.com/wago-org/wasi/p2',Test:'P2/B',Action:'skip'}
  ].map(JSON.stringify).join('\n')};
  const report={host,created:'2026-10-01',sha256:'a'.repeat(64),lanes:[lane]};
  const out=pluginEvidence([{...report,host:{...host,arch:'x64'}},report],{...host,hostname:'mac.tailnet'},{'mac.local':'mac','mac.tailnet':'mac'});
  assert.equal(out['wasi-p1'].passed,1);assert.equal(out['wasi-p2'].passed,1);assert.equal(out['wasi-p2'].total,2);assert.equal(out['wasi-p2'].skipped,1);
  assert.deepEqual(pluginEvidence([{...report,lanes:[{...lane,status:'runner-error'}]}],host),{});
  assert.deepEqual(pluginEvidence([report],{...host,hostname:'another-mac'}),{});
  const hub={hostname:'hub',os:'linux',arch:'x64'};
  assert.equal(pluginEvidence([{...report,host:hub}],{...hub,arch:'amd64'})['wasi-p2'].passed,1);
});
