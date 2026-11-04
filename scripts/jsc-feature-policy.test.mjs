import test from 'node:test';
import assert from 'node:assert/strict';
import {withJSCFeatureFlag} from './lib/jsc-feature-policy.mjs';
test('explicit JSC proposal flag retains the original OMG and option-validation launch',()=>{
 const before='before\n\t\tcase "jsc":\n\t\t\targs = append(args, "--validateOptions=true", "--useOMGJIT=true", script)\nafter';
 const after=withJSCFeatureFlag(before);
 assert(after.includes('if os.Getenv("WASMBENCH_JSC_WIDE_ARITHMETIC") == "1"'));
 assert(after.includes('args = append(args, "--useWasmWideArithmetic=true")'));
 assert(after.includes('args = append(args, "--validateOptions=true", "--useOMGJIT=true", script)'));
 assert.equal(withJSCFeatureFlag(after),after);
 assert.throws(()=>withJSCFeatureFlag('changed seam'));
});
