import test from 'node:test';
import assert from 'node:assert/strict';
import {historyIntegrationFailure} from './lib/history-completion-audit.mjs';

test('missing host-profile and ordered-vector adapters remain integration repairs', () => {
  assert.equal(historyIntegrationFailure({failures:[{reason:'unsupported: extended workload contract host_profile'}]}), true);
  assert.equal(historyIntegrationFailure({reason:'ordered vector timing capability/profile not supported'}), true);
});

test('engine feature rejections and bounded timeouts remain recorded outcomes', () => {
  assert.equal(historyIntegrationFailure({reason:'unsupported: SIMD instructions rejected by pinned engine'}), false);
  assert.equal(historyIntegrationFailure({kind:'timeout',budgetMs:300000,error:'The operation was aborted due to timeout'}), false);
});
