import test from 'node:test';
import assert from 'node:assert/strict';
import {singleWorkloadBudgetOverride} from './lib/history-workload-failure.mjs';

test('extended budgets apply only to one workload and stay bounded',()=>{
 assert.equal(singleWorkloadBudgetOverride(undefined,148),0);
 assert.equal(singleWorkloadBudgetOverride('1800000',1),1800000);
 for(const [value,count] of [['1800000',2],['299999',1],['3600001',1],['not-a-number',1]])assert.throws(()=>singleWorkloadBudgetOverride(value,count),/Invalid single-workload budget/);
});
