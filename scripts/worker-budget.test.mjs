import test from 'node:test';
import assert from 'node:assert/strict';
import { workersWithinCpuBudget } from './lib/worker-budget.mjs';

test('benchmark workers never exceed one quarter of available logical CPUs', () => {
  assert.equal(workersWithinCpuBudget(16, 3), 3);
  assert.equal(workersWithinCpuBudget(8, 3), 2);
  assert.equal(workersWithinCpuBudget(4, 3), 1);
  assert.throws(() => workersWithinCpuBudget(3, 1), /requires at least four/);
});

test('pinned workers respect both the machine quarter and the affinity mask',()=>{
 assert.equal(workersWithinCpuBudget(8,2,2),2);
 assert.equal(workersWithinCpuBudget(16,3,1),1);
 assert.equal(workersWithinCpuBudget(8,3,8),2);
 assert.throws(()=>workersWithinCpuBudget(8,2,0),/available CPU/);
});
