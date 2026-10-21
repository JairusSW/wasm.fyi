import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {wasmerNativeSizeGetter} from './lib/wasmer-native-size.mjs';

test('historical Wasmer builds use the source-pinned observer when an old harness lacks it',async t=>{
 const root=await mkdtemp(join(tmpdir(),'wasmer-native-size-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const getter=await wasmerNativeSizeGetter(root);
 assert.match(getter,/wasmbench_module_native_function_size/);
 await mkdir(join(root,'adapters/native'),{recursive:true});
 await writeFile(join(root,'adapters/native/wasmer-native-size.rs'),getter);
 assert.equal(await wasmerNativeSizeGetter(root),getter);
 await writeFile(join(root,'adapters/native/wasmer-native-size.rs'),getter+'// drift\n');
 await assert.rejects(wasmerNativeSizeGetter(root),/differs from the source-pinned site patch/);
});
