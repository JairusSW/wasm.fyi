import test from 'node:test';
import assert from 'node:assert/strict';
import { executeVectors, checkUpstreamV8 } from './feature-upstream-v8.mjs';

const vectors = [{ operation: 'test', args: ['foo'], expected: 1 }];
const mockEngine = overrides => ({
  compile: async () => ({}),
  Module: { imports: () => [] },
  instantiate: async () => ({ exports: { test: () => 1 } }),
  ...overrides,
});

test('actual selected vectors use integrity-checked Wasm JS-string builtins', async t => {
  const report = await checkUpstreamV8();
  assert.equal(report.timing, false);
  assert.equal(report.outcomes.length, 44);
  assert.equal(report.outcomes.filter(o => o.status === 'failed').length, 0);
  if (report.outcomes.every(o => o.status === 'unavailable')) {
    t.skip('This engine does not provide Wasm JS-string builtins');
    return;
  }
  assert(report.outcomes.every(o => o.status === 'verified' && o.repetitions === 3));
});

test('compile-time unsupported proposals report unavailable', async () => {
  const outcomes = await executeVectors(new Uint8Array(), vectors, mockEngine({
    compile: async () => { throw new WebAssembly.CompileError('unsupported proposal'); },
  }));
  assert.equal(outcomes[0].status, 'unavailable');
});

test('ignored compile options never fall back to a JavaScript polyfill', async () => {
  let instantiated = false;
  const outcomes = await executeVectors(new Uint8Array(), vectors, mockEngine({
    Module: { imports: () => [{ module: 'wasm:js-string', name: 'test', kind: 'function' }] },
    instantiate: async () => { instantiated = true; },
  }));
  assert.equal(outcomes[0].status, 'unavailable');
  assert.equal(instantiated, false);
});

test('admitted but incorrect results report failed', async () => {
  const outcomes = await executeVectors(new Uint8Array(), vectors, mockEngine({
    instantiate: async () => ({ exports: { test: () => 0 } }),
  }));
  assert.equal(outcomes[0].status, 'failed');
  assert.match(outcomes[0].reason, /Expected 1, received 0/);
});

test('post-admission traps and linking errors are failures rather than unavailable', async () => {
  for (const instantiate of [
    async () => ({ exports: { test: () => { throw new WebAssembly.RuntimeError('unexpected trap'); } } }),
    async () => { throw new WebAssembly.LinkError('unexpected link failure'); },
  ]) {
    const outcomes = await executeVectors(new Uint8Array(), vectors, mockEngine({ instantiate }));
    assert.equal(outcomes[0].status, 'failed');
  }
});

test('unexpected host errors and unknown vector operations do not become skips', async () => {
  await assert.rejects(executeVectors(new Uint8Array(), vectors, mockEngine({
    compile: async () => { throw new Error('unexpected host failure'); },
  })), /unexpected host failure/);
  await assert.rejects(executeVectors(new Uint8Array(), [{ operation: 'unknown', args: [], expected: 0 }]), /Unsupported vector shape/);
});

test('successful vectors are actually invoked three times', async () => {
  let calls = 0;
  const outcomes = await executeVectors(new Uint8Array(), vectors, mockEngine({
    instantiate: async () => ({ exports: { test: () => { calls++; return 1; } } }),
  }));
  assert.equal(outcomes[0].status, 'verified');
  assert.equal(calls, 3);
});
