import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {applyW2c2Bridge} from './lib/w2c2-bridge.mjs';

test('W2C2 bridge selects packaged SIMDe headers and can be applied again', async () => {
 const root=await mkdtemp(join(tmpdir(),'wasmfyi-w2c2-bridge-'));
 try {
  const dir=join(root,'adapters/native/src');
  await mkdir(dir,{recursive:true});
  const file=join(dir,'aot.rs');
  await writeFile(file,`fn ctype() {}\n#[derive(Clone)]\nstruct Stage;\nfn use_bridge() {\n w2c2_export_symbol(header, &name);\n w2c2_export_symbol(header, "memory");\n bridge(c.wasm2c(), &exports, &memory, identity, abort, &header);\n            args.push(format!("-I{}", c.sdk.display()));\n}\n`);
  await applyW2c2Bridge(root);
  const source=await readFile(file,'utf8');
  assert.match(source,/c\.sdk\.join\("simde\/wasm\/simd128\.h"\)\.is_file\(\)/);
  assert.ok(source.includes('args.push("-DW2C2_SIMDE_HEADER=\\"simde/wasm/simd128.h\\"".into());'));
  await applyW2c2Bridge(root);
  assert.equal(await readFile(file,'utf8'),source);
 } finally { await rm(root,{recursive:true,force:true}); }
});
