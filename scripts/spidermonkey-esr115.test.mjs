import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {repairSpiderMonkeyESR115} from './lib/spidermonkey-esr115.mjs';
import {digest} from './lib/wasmbench.mjs';
const moves='ExclusiveData(ExclusiveData&& rhs)\n      : lock_(std::move(rhs.lock)), value_(std::move(rhs.value_)) {\n    MOZ_ASSERT(&rhs != this, "self-move disallowed!");\n  }\n\n  ExclusiveData& operator=(ExclusiveData&& rhs) {\n    this->~ExclusiveData();\n    new (mozilla::KnownNotNull, this) ExclusiveData(std::move(rhs));\n    return *this;\n  }';
const original='// upstream prefix\n  '+moves+'\n// upstream suffix\n';
const corrected=original.replace(moves,'ExclusiveData(ExclusiveData&&) = delete;\n  ExclusiveData& operator=(ExclusiveData&&) = delete;');
const env={WASMFYI_SPIDERMONKEY_ESR115_MOVE_FIX:'1'};
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'spider-esr115-'));t.after(()=>rm(root,{recursive:true,force:true}));const path=join(root,'js/src/threading/ExclusiveData.h');await mkdir(join(root,'js/src/threading'),{recursive:true});await writeFile(path,original);return {root,path};}
test('deletes only the unusable move operations and records both source hashes',async t=>{
 const {root,path}=await fixture(t),proof=await repairSpiderMonkeyESR115(root,'1.66.0',env,'linux');
 assert.equal(await readFile(path,'utf8'),corrected);assert.equal(await readFile(path+'.wasmfyi-before','utf8'),original);assert.equal(proof.originalSha256,digest(Buffer.from(original)));assert.equal(proof.compiledSha256,digest(Buffer.from(corrected)));assert.deepEqual(await repairSpiderMonkeyESR115(root,'1.66.0',env,'linux'),proof);
});
test('opt-out, newer sources, and other platforms do not even open the source',async()=>{
 for(const [minimum,settings,platform] of [['1.66.0',{},'linux'],['1.80.0',env,'linux'],['1.66.0',env,'darwin']])assert.equal(await repairSpiderMonkeyESR115('/missing',minimum,settings,platform),null);
});
test('an already-correct upstream header is preserved',async t=>{
 const {root,path}=await fixture(t);await writeFile(path,corrected);assert.equal(await repairSpiderMonkeyESR115(root,'1.66.0',env,'linux'),null);assert.equal(await readFile(path,'utf8'),corrected);
});
test('a failed member-name attempt can be replaced only from the retained original',async t=>{
 const {root,path}=await fixture(t);await writeFile(path+'.wasmfyi-before',original);await writeFile(path,original.replace('rhs.lock)', 'rhs.lock_)'));const proof=await repairSpiderMonkeyESR115(root,'1.66.0',env,'linux');assert.equal(await readFile(path,'utf8'),corrected);assert.equal(proof.originalSha256,digest(Buffer.from(original)));
});
test('unknown source edits after qualification reject rather than being overwritten',async t=>{
 const {root,path}=await fixture(t);await repairSpiderMonkeyESR115(root,'1.66.0',env,'linux');await writeFile(path,(await readFile(path,'utf8'))+'unrelated edit');await assert.rejects(repairSpiderMonkeyESR115(root,'1.66.0',env,'linux'),/changed outside/);
});
