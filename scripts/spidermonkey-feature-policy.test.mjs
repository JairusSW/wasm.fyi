import test from 'node:test';
import assert from 'node:assert/strict';
import {availableSpiderMonkeyPrefs,withSpiderMonkeyFeaturePrefs} from './lib/spidermonkey-feature-policy.mjs';

test('proposal preferences are selected from the pinned shell inventory',()=>{
 assert.deepEqual(availableSpiderMonkeyPrefs('wasm_memory_control=false  [not fuzzing-safe]\nwasm_stack_switching=false\nwasm_test_serialization=false'),['wasm_memory_control','wasm_stack_switching']);
 assert.deepEqual(availableSpiderMonkeyPrefs('help mentions wasm_memory_control=false'),[]);
});
test('shell launch retains Ion mode and validates proposal preferences before the script',()=>{
 const before='before\n\t\tcase "spidermonkey":\n\t\t\targs = append(args, "--wasm-compiler=ion", "-f", script, "--")\nafter';
 const after=withSpiderMonkeyFeaturePrefs(before);
 assert(after.indexOf('pref+"=true"')<after.indexOf('"--wasm-compiler=ion"'));
 assert(after.includes('invalid SpiderMonkey proposal preference'));
 assert(after.includes('args = append(args, "--setpref="+pref+"=true")'));
 assert(!after.includes('args = append(args, "-P", pref+"=true")'));
 assert.equal(withSpiderMonkeyFeaturePrefs(after),after);
 const old=after.replace('preferences v2','preferences v1').replace('args = append(args, "--setpref="+pref+"=true")','args = append(args, "-P", pref+"=true")');
 assert.equal(withSpiderMonkeyFeaturePrefs(old),after);
 assert.throws(()=>withSpiderMonkeyFeaturePrefs('changed seam'));
});
