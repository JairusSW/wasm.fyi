import assert from 'node:assert/strict';
import test from 'node:test';
import {
  featureFailureForOutcomes,
  normalizeRepairedFeatureItem,
  repairedFeatureOutcomes,
} from './lib/feature-repair-ledger.mjs';

test('successful repair replaces only requested phases and clears stale failure', () => {
  const failure = {reason: 'old adapter failure'};
  const prior = {failure, outcomes: [['compile', 'ok'], ['first-call', 'failed'], ['steady', 'failed']]};
  const capture = {results: [{phase: 'first-call', latencyStatus: 'ok'}, {phase: 'steady', latencyStatus: 'ok'}]};
  const outcomes = repairedFeatureOutcomes(prior, capture, ['first-call', 'steady']);
  assert.deepEqual(outcomes, [['compile', 'ok'], ['first-call', 'ok'], ['steady', 'ok']]);
  assert.equal(featureFailureForOutcomes(prior, outcomes), undefined);
  assert.equal(normalizeRepairedFeatureItem({...prior, outcomes}), true);
});

test('partial repair retains the original failure until every failed phase is repaired', () => {
  const failure = {reason: 'old adapter failure'};
  const prior = {failure, outcomes: [['compile', 'failed'], ['first-call', 'failed']]};
  const capture = {results: [{phase: 'first-call', latencyStatus: 'ok'}]};
  const outcomes = repairedFeatureOutcomes(prior, capture, ['first-call']);
  assert.deepEqual(outcomes, [['compile', 'failed'], ['first-call', 'ok']]);
  assert.equal(featureFailureForOutcomes(prior, outcomes), failure);
  const item = {...prior, outcomes};
  assert.equal(normalizeRepairedFeatureItem(item), false);
  assert.equal(item.failure, failure);
});

test('a new failure replaces an old failure during repair', () => {
  const note = {reason: 'new failure'};
  assert.equal(featureFailureForOutcomes({failure: {reason: 'old'}}, [['steady', 'failed']], note), note);
});
