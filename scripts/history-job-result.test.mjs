import test from 'node:test';
import assert from 'node:assert/strict';
import {completedHistoryJob} from './lib/history-job-result.mjs';

test('a fully traversed job can contain persisted failed workloads', () => {
  assert.equal(completedHistoryJob({status:'completed-with-errors', completed:148, errors:[{workload:'unsupported-sdk-case'}]}, 148), true);
  assert.equal(completedHistoryJob({status:'completed', completed:148}, 148), true);
});

test('paused, running and partially traversed jobs remain incomplete', () => {
  for (const status of ['paused', 'running', 'yielded']) {
    assert.equal(completedHistoryJob({status, completed:148}, 148), false);
  }
  assert.equal(completedHistoryJob({status:'completed-with-errors', completed:147}, 148), false);
});
