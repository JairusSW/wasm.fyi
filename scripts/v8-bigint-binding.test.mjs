import test from 'node:test';import assert from 'node:assert/strict';
import {withV8BigIntBinding} from './lib/v8-bigint-binding.mjs';
test('adds typed BigInt argument binding without changing ordinary integer calls',()=>{
 const source=`let floatSignature;\nfunction argumentsForCall() {if(floatSignature)return floatArguments(prep.workload.args,floatSignature.params);return prep.workload.args.map(x=>{const n=Number(x);if(!Number.isSafeInteger(n))throw new Error('i64 arguments require typed argument support');return n;});}\nfloatSignature=undefined; module=instance=undefined;\nfloatSignature=numericSignature(bytes,prep.workload.export);\n        validateFloat(prep.workload.oracle,floatSignature.results);`;
 const once=withV8BigIntBinding(source);assert.match(once,/integerSignature/);assert.match(once,/features\?\.includes\('big-int'\)/);assert.equal(withV8BigIntBinding(once),once);
});
