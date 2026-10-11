import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {applyWagoColdCompile} from './lib/wago-cold-compile.mjs';
const seam='\tif e := a.setup(); e != nil {\n\t\treturn nil, e\n\t}\n\tvar serialized []byte';
async function fixture(source,action){const root=await mkdtemp(join(tmpdir(),'wago-cold-'));try{await mkdir(join(root,'adapters/wago'),{recursive:true});await writeFile(join(root,'adapters/wago/main.go'),source);await action(root);}finally{await rm(root,{recursive:true,force:true});}}
test('binding change is idempotent and records exact adapted source',async()=>fixture(seam,async root=>{const first=await applyWagoColdCompile(root),second=await applyWagoColdCompile(root);assert.deepEqual(first,second);assert.equal(first.sdkModified,false);assert.match(await readFile(join(root,'adapters/wago/main.go'),'utf8'),/if r.Scenario != "compile"/);assert.match(await readFile(join(root,'adapters/wago/cold_compile_test.go'),'utf8'),/TestColdCompileStillRejectsWrongGuestResult/);}));
test('changed SDK embedding fails closed without mutation',async()=>fixture('different embedding',async root=>{await assert.rejects(applyWagoColdCompile(root),/seam changed/);assert.equal(await readFile(join(root,'adapters/wago/main.go'),'utf8'),'different embedding');}));
test('ambiguous setup sites fail closed',async()=>fixture(seam+'\n'+seam,async root=>{await assert.rejects(applyWagoColdCompile(root),/ambiguous/);assert.equal(await readFile(join(root,'adapters/wago/main.go'),'utf8'),seam+'\n'+seam);}));
