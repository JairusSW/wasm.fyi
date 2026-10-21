import test from 'node:test';
import assert from 'node:assert/strict';
import {withV8FreshSampling} from './lib/v8-fresh-sampling.mjs';

const modern=`
let compiled = r.scenario === 'compile' ? undefined : (cachedModule ||= new WebAssembly.Module(bytes));
let shared = r.scenario === 'steady' ? (cachedSteady ||= initialize(new WebAssembly.Instance(compiled, imports))) : undefined;
if (r.scenario === 'first-call') target = initialize(new WebAssembly.Instance(module, imports));
if (r.scenario === 'compile' || r.scenario === 'instantiate') { target = initialize(target || new WebAssembly.Instance(module, imports)); result = invoke(target,args); verify(result,target); }
`;

test('unified JS shell fresh-sample validation needs no legacy rewrite',()=>{
 assert.equal(withV8FreshSampling(modern),modern);
 for(const part of modern.trim().split('\n')){
  assert.throws(()=>withV8FreshSampling(modern.replace(part,'')),/validation seam changed/);
 }
});

test('current V8 adapter removes the untimed priming invocation',()=>{
 const before="      setup();\n      if (!['first-call', 'trajectory', 'teardown'].includes(r.scenario)) verify(invoke());";
 const after=withV8FreshSampling(before);
 assert.match(after,/if\(r\.scenario!==\'compile\'\)setup\(\);/);
 assert.doesNotMatch(after,/verify\(invoke\(\)\)/);
 assert.equal(withV8FreshSampling(after),after);
});
