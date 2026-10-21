import {test} from 'node:test';
import assert from 'node:assert/strict';
import {privateELFInterpreterSource} from './lib/private-elf-interpreter.mjs';

const source=`package experiment
func probe(){
\t\tif interpreter != allowed || allowed == "" {
\t\t\treturn "", true, fmt.Errorf("unsupported ELF interpreter %q", interpreter)
\t\t}
}`;

test('private ELF interpreter allowance is exact, configured, AMD64-only, and idempotent',()=>{
 const patched=privateELFInterpreterSource(source);
 assert.match(patched,/image\.Machine == elf\.EM_X86_64/);
 assert.match(patched,/os\.Getenv\("WASMFYI_PRIVATE_GLIBC_LIBRARY_DIR"\)/);
 assert.match(patched,/filepath\.Join\(absolute, "ld-linux-x86-64\.so\.2"\)/);
 assert.match(patched,/interpreter != allowed && interpreter != privateAllowed/);
 assert.equal(privateELFInterpreterSource(patched),patched);
 assert.throws(()=>privateELFInterpreterSource('changed'),/seam changed/);
});
