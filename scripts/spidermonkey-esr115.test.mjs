import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {repairSpiderMonkeyESR115} from './lib/spidermonkey-esr115.mjs';
import {digest} from './lib/wasmbench.mjs';
const original='// upstream prefix\nExclusiveData(ExclusiveData&& rhs)\n      : lock_(std::move(rhs.lock)), value_(std::move(rhs.value_)) {\n MOZ_ASSERT(&rhs != this, "self-move disallowed!");\n}\n// upstream suffix\n';
const env={WASMFYI_SPIDERMONKEY_ESR115_MEMBER_FIX:'1'};
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'spider-esr115-'));t.after(()=>rm(root,{recursive:true,force:true}));const path=join(root,'js/src/threading/ExclusiveData.h');await mkdir(join(root,'js/src/threading'),{recursive:true});await writeFile(path,original);return {root,path};}
test('repairs only the qualified member name and records both source hashes',async t=>{
 const {root,path}=await fixture(t),proof=await repairSpiderMonkeyESR115(root,'1.66.0',env,'linux');
 const corrected=original.replace('rhs.lock)', 'rhs.lock_)');assert.equal(await readFile(path,'utf8'),corrected);assert.equal(await readFile(path+'.wasmfyi-before','utf8'),original);assert.equal(proof.originalSha256,digest(Buffer.from(original)));assert.equal(proof.compiledSha256,digest(Buffer.from(corrected)));assert.deepEqual(await repairSpiderMonkeyESR115(root,'1.66.0',env,'linux'),proof);
});
test('opt-out, newer sources, and other platforms do not even open the source',async()=>{
 for(const [minimum,settings,platform] of [['1.66.0',{},'linux'],['1.80.0',env,'linux'],['1.66.0',env,'darwin']])assert.equal(await repairSpiderMonkeyESR115('/missing',minimum,settings,platform),null);
});
test('an already-correct upstream header is preserved',async t=>{
 const {root,path}=await fixture(t);const corrected=original.replace('rhs.lock)', 'rhs.lock_)');await writeFile(path,corrected);assert.equal(await repairSpiderMonkeyESR115(root,'1.66.0',env,'linux'),null);assert.equal(await readFile(path,'utf8'),corrected);
});
test('unknown source edits after qualification reject rather than being overwritten',async t=>{
 const {root,path}=await fixture(t);await repairSpiderMonkeyESR115(root,'1.66.0',env,'linux');await writeFile(path,(await readFile(path,'utf8'))+'unrelated edit');await assert.rejects(repairSpiderMonkeyESR115(root,'1.66.0',env,'linux'),/changed outside/);
});
