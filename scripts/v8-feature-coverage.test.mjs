import test from 'node:test';
import assert from 'node:assert/strict';
import {withV8FeatureCoverage} from './lib/v8-feature-coverage.mjs';
const source=`const featureProbes={};
const validatorFeatures = {supported:Object.fromEntries(Object.entries(featureProbes).map(([key,value])=>[key,WebAssembly.validate(Buffer.from(value,'base64'))]))};
const capabilities={'can_host_profile_threads-defined-v1':true,};
function prepare(prep){const imports={};
 if(!['identity-v1','threads-defined-v1','wasi-preview1-readonly-v1'].includes(prep.workload.host_profile))throw Error('unsupported host profile');
 if(prep.workload.host_profile==='identity-v1'){imports.wasmbench={identity:v=>v};}
 return imports;
}`;
const probes={COMPACT_IMPORTS:'compact',WIDE_ARITHMETIC:'wide'};
test('admits both thread callback profiles through the ordinary typed identity import',()=>{
 const updated=withV8FeatureCoverage(source,probes);
 const prepare=new Function(updated+';return prepare;')();
 for(const host_profile of ['identity-v1','threads-identity-v1','threads-opaque-identity-v1'])assert.equal(prepare({workload:{host_profile}}).wasmbench.identity(19),19);
 assert.throws(()=>prepare({workload:{host_profile:'unknown'}}));
});
test('adds actual decoder probes and remains idempotent',()=>{
 const updated=withV8FeatureCoverage(source,probes);
 assert(updated.includes('Object.assign(featureProbes,'));
 assert(updated.includes('can_host_profile_threads-opaque-identity-v1'));
 assert.equal(withV8FeatureCoverage(updated,probes),updated);
 assert.throws(()=>withV8FeatureCoverage(source,{}));
 assert.throws(()=>withV8FeatureCoverage('',probes));
});
