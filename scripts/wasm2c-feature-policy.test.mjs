import test from 'node:test';
import assert from 'node:assert/strict';
import {withWasm2cExceptions} from './lib/wasm2c-exceptions.mjs';

const adapter=`
        let args = if c.wasm2c() {
            vec!["wb.wasm", "-n", "wb", "-o", "wb.c"]
        } else { vec![] };
        if c.wasm2c() {
            args.extend([
                "-D_POSIX_C_SOURCE=200809L".into(),
                "-DWASM_RT_MEMCHECK_SIGNAL_HANDLER=0".into(),
                runtime.join("wasm-rt-mem-impl.c").display().to_string(),
            ]);
        }
`;

test('wasm2c enables its declared custom page size proposal',()=>{
 const result=withWasm2cExceptions(adapter);
 assert.match(result,/vec!\["wb\.wasm", "--enable-custom-page-sizes", "-n", "wb", "-o", "wb\.c"\]/);
 assert.match(result,/wasm-rt-exceptions-impl\.c/);
 assert.equal(withWasm2cExceptions(result),result);
});

test('wasm2c feature policy fails closed when the translator seam changes',()=>{
 assert.throws(()=>withWasm2cExceptions(adapter.replace('vec!["wb.wasm", "-n", "wb", "-o", "wb.c"]','vec!["different"]')),/translation feature seam absent/);
});
