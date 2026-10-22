import{test}from'node:test';import assert from'node:assert/strict';import{withChicorySimd,chicoryVectorOptions}from'./lib/chicory-simd.mjs';
test('SIMD machine installation preserves interpreter and reports explicit identity',()=>{const source='var builder=Instance.builder(module);\n {"effective_configuration":{"tiering":"Wasm interpreter"}}';const got=withChicorySimd(source);assert.match(got,/withMachineFactory\(com.dylibso.chicory.simd.SimdInterpreterMachine::new\)/);assert.match(got,/"interpreter_machine":"SimdInterpreterMachine; JDK incubator vector enabled"/);assert.match(got,/"tiering":"Wasm interpreter"/);assert.equal(withChicorySimd(got),got);});
test('unknown instance factory cannot silently skip SIMD wiring',()=>assert.throws(()=>withChicorySimd('var builder=unknown();')));
test('restores the vector module only for a matching pinned SIMD receipt',()=>{
 const receipt={pin:{revision:'a'.repeat(40)},provenance:{sdk:{simdMachine:true}}};
 const options=chicoryVectorOptions('-Xmx2g',{revision:'a'.repeat(40),receipt});
 assert.equal(options,'-Xmx2g --add-modules=jdk.incubator.vector');
 assert.equal(chicoryVectorOptions(options,{revision:'a'.repeat(40),receipt}),options);
 assert.equal(chicoryVectorOptions('-Xmx2g',{revision:'b'.repeat(40),receipt}),'-Xmx2g');
 assert.equal(chicoryVectorOptions('',{revision:'a'.repeat(40),receipt:{...receipt,provenance:{sdk:{simdMachine:false}}}}),'');
 assert.equal(chicoryVectorOptions(undefined,{revision:'a'.repeat(40)}),'');
});
test('retains the original revision-bound SIMD repair receipt',()=>{
 const repair={status:'adapter-rebuilt',sourceRevision:'a'.repeat(40)};
 assert.equal(chicoryVectorOptions('',{revision:'a'.repeat(40),repair}),'--add-modules=jdk.incubator.vector');
 assert.equal(chicoryVectorOptions('',{revision:'b'.repeat(40),repair}),'');
});
