// This intentionally requires the native API from the proposal. The newer V8
// tests' WebAssemblyFunction polyfill does not qualify as type reflection.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const [name,path,iterations='1']=process.argv.slice(2);
if(typeof WebAssembly.Function!=='function')throw Error('Native type-reflection API unavailable');
const module=await WebAssembly.compile(await readFile(path));
const instance=await WebAssembly.instantiate(module);
for(let invocation=0;invocation<Number(iterations);invocation++) {
if(name==='function-type')assert.deepEqual(instance.exports.value.type(),{parameters:[],results:['i32']});
else if(name==='typed-host-function') {
 const f=new WebAssembly.Function({parameters:['i64'],results:['i64']},x=>x+7n);
 assert.equal(f(9007199254740993n),9007199254741000n);
 assert.deepEqual(f.type(),{parameters:['i64'],results:['i64']});
}else if(name==='global-type')assert.deepEqual(new WebAssembly.Global({value:'i64',mutable:true},7n).type(),{value:'i64',mutable:true});
else if(name==='memory-type') {
 const t=new WebAssembly.Memory({initial:1,maximum:3}).type();
 assert.equal(t.minimum,1);assert.equal(t.maximum,3);assert.equal(t.shared,false);
}else if(name==='table-type') {
 const t=new WebAssembly.Table({element:'externref',initial:2,maximum:4}).type();
 assert.equal(t.minimum,2);assert.equal(t.maximum,4);assert.equal(t.element,'externref');
}else throw Error('Unknown reflection case');
}
console.log(JSON.stringify({case:name,status:'verified'}));
