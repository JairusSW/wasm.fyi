import test from 'node:test';
import assert from 'node:assert/strict';
import {featureProtocolWorkload} from './lib/feature-protocol.mjs';
test('native protocol preserves full u64 bits and leaves the source corpus unchanged',()=>{
 const source={args:[4096,'18446744073709551615'],oracle:{kind:'exact_u64',expected:[4294967295]}};
 const wire=featureProtocolWorkload(source);
 assert.deepEqual(wire.args,['4096','18446744073709551615']);
 assert.deepEqual(wire.oracle.expected,['4294967295']);
 assert.deepEqual(source.args,[4096,'18446744073709551615']);
 assert.deepEqual(source.oracle.expected,[4294967295]);
});
test('unsafe numbers and out-of-range strings cannot become apparently exact oracles',()=>{
 for(const value of [Number.MAX_SAFE_INTEGER+1,-1,1.5,'18446744073709551616','-1','1e3']){
  assert.throws(()=>featureProtocolWorkload({args:[value]}));
  assert.throws(()=>featureProtocolWorkload({oracle:{expected:[value]}}));
 }
});
