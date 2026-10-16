import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {nodeFmtHeaderPatch} from './lib/node-fmt-stdlib.mjs';

const header='#ifndef FMT_MODULE\n#  include <cmath>\n#endif\ntemplate <typename T> struct allocator {\n T* allocate(size_t n) { return static_cast<T*>(malloc(n * sizeof(T))); }\n void deallocate(T* p, size_t) { free(p); }\n};\n';
test('Darwin fmt repair adds only its missing standard header and records exact hashes',()=>{
 const result=nodeFmtHeaderPatch(header,'darwin');
 assert.equal(result.text,header.replace('#ifndef FMT_MODULE\n','#ifndef FMT_MODULE\n#  include <cstdlib>  // wasm.fyi: fmt malloc/free declarations\n'));
 assert.equal(result.proof.beforeSha256,createHash('sha256').update(header).digest('hex'));
 assert.equal(result.proof.afterSha256,createHash('sha256').update(result.text).digest('hex'));
 assert.deepEqual(nodeFmtHeaderPatch(result.text,'darwin'),result);
});
test('other platforms, already-correct headers and older fmt releases remain intact',()=>{
 for(const [text,platform] of [[header,'linux'],[header.replace('<cmath>','<cstdlib>'),'darwin'],['older fmt without this allocator','darwin']])assert.deepEqual(nodeFmtHeaderPatch(text,platform),{text,proof:null});
 assert.throws(()=>nodeFmtHeaderPatch(header.replace('#ifndef FMT_MODULE','unrecognized seam'),'darwin'),/Unrecognized/);
});
