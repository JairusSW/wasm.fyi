import test from 'node:test';
import assert from 'node:assert/strict';
import {withV8NativeCompileOptions} from './lib/v8-native-compile-options.mjs';
test('native size diagnostics use the measured module compile options',()=>{
 const input=`function inspectNativeSize(artifact, bytes, moduleSha256, mode) { const program='new WebAssembly.Module(bytes);'; return [program,artifact,moduleSha256]; }`;
 const output=withV8NativeCompileOptions(input);
 assert(output.includes('mode, compileOptions={}'));
 assert(output.includes('new WebAssembly.Module(bytes,JSON.parse(process.argv[3]))'));
 assert(output.includes('JSON.stringify(compileOptions)'));
 assert.equal(withV8NativeCompileOptions(output),output);
 assert.throws(()=>withV8NativeCompileOptions('unknown'));
});
