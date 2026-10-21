import test from 'node:test';
import assert from 'node:assert/strict';
import {applyJavaScriptSampling} from './lib/js-shell-sampling.mjs';

const prefix=`  let prep, bytes, signature;
prep = bytes = signature = undefined;
`;

test('sampling migration supports scalar-only historical JavaScript adapters',()=>{
 const source=prefix+`let compiled = r.scenario === 'compile' ? undefined : new WebAssembly.Module(bytes);
let shared = r.scenario === 'steady' ? initialize(new WebAssembly.Instance(compiled, imports)) : undefined;
prep = bytes = signature = undefined;
`;
 const migrated=applyJavaScriptSampling(source);
 assert.match(migrated,/cachedModule \|\|= new WebAssembly\.Module/);
 assert.match(migrated,/cachedSteady \|\|= initialize/);
 assert.match(migrated,/signature = cachedModule = cachedSteady = cachedVectors = undefined/);
 assert.equal(applyJavaScriptSampling(migrated),migrated);
});

test('sampling migration supports feature-complete vector JavaScript adapters',()=>{
 const source=prefix+`const w=prep.workload,v=w.vectors,cases=vectorCases(w),samples=[];
const shared=r.scenario==='compile'?undefined:new WebAssembly.Module(bytes);
const start=now(),target=new WebAssembly.Instance(module);
let compiled = r.scenario === 'compile' ? undefined : new WebAssembly.Module(bytes);
let shared = r.scenario === 'steady' && !freshSteady ? initialize(new WebAssembly.Instance(compiled, imports)) : undefined;
`;
 const migrated=applyJavaScriptSampling(source);
 assert.match(migrated,/cases=cachedVectors \|\|= vectorCases/);
 assert.match(migrated,/cachedModule \|\|= new WebAssembly\.Module/);
 assert.match(migrated,/cachedSteady \|\|= new WebAssembly\.Instance/);
 assert.match(migrated,/cachedSteady \|\|= initialize/);
});

test('sampling migration rejects an unknown steady-instance layout',()=>{
 assert.throws(()=>applyJavaScriptSampling(prefix+`let compiled = r.scenario === 'compile' ? undefined : new WebAssembly.Module(bytes);`),/steady instance/);
});
