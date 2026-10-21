import test from 'node:test';
import assert from 'node:assert/strict';
import {assertWazeroInterruptsDisabled,disableWazeroInterrupts} from './lib/wazero-sampling.mjs';

test('Wazero benchmark adapters cannot silently re-enable context interruption',()=>{
 assert.doesNotThrow(()=>assertWazeroInterruptsDisabled('"context_termination":"disabled"'));
 assert.throws(()=>assertWazeroInterruptsDisabled('c.WithCloseOnContextDone(true)'),/must stay disabled/);
 assert.throws(()=>assertWazeroInterruptsDisabled('"context_termination":"enabled"'),/still claims/);
});
test('legacy harnesses are normalized before rebuilding',()=>{
 const source=disableWazeroInterrupts('c.WithCloseOnContextDone(true); "context_termination":"enabled"');
 assert(!source.includes('WithCloseOnContextDone'));assert(source.includes('"context_termination":"disabled"'));
});
