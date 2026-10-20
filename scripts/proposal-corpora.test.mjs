import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fixtures} from '../corpora/features/generator.mjs';
import {nativeProposalCheck,unavailableProposal} from './lib/proposal-validation.mjs';
import {checkProposalMetadata} from './lib/proposal-metadata.mjs';
import {wasmtimeTestFlags,v8TestArguments,proposalSuites} from './lib/proposal-upstream.mjs';
import {site} from './lib/wasmbench.mjs';
const root=join(site,'corpora/features');
const manifest=JSON.parse(await readFile(join(root,'manifest.json')));
const row=(feature,name)=>{
 const w=manifest.find(w=>w.id.startsWith(`features/${feature}/${name}/`));
 assert.ok(w);return {...w,artifact:join(root,w.artifact)};
};

test('fresh source builds require a separate empty output directory',async()=>{
 const noOutput=spawnSync(process.execPath,['scripts/feature-corpus.mjs','build','--fresh'],{cwd:site,encoding:'utf8'});
 assert.notEqual(noOutput.status,0);assert.match(noOutput.stderr,/--fresh requires build --out/);
 const output=await mkdtemp(join(tmpdir(),'proposal-build-guard-'));
 try {
  await writeFile(join(output,'keep'),'existing source');
  const occupied=spawnSync(process.execPath,['scripts/feature-corpus.mjs','build','--fresh','--out='+output],{cwd:site,encoding:'utf8'});
  assert.notEqual(occupied.status,0);assert.match(occupied.stderr,/output directory must be empty/);
  assert.equal(await readFile(join(output,'keep'),'utf8'),'existing source');
 } finally {await rm(output,{recursive:true,force:true});}
});

test('native validation rejects wrong results, wrong artifact digests and wrong data bytes',async()=>{
 const w=row('typed-function-references','reference-composition');
 assert.equal((await nativeProposalCheck(w)).status,'verified');
 await assert.rejects(nativeProposalCheck({...w,sha256:'0'.repeat(64)}),/digest mismatch/);
 await assert.rejects(nativeProposalCheck({...w,oracle:{...w.oracle,expected:[Number(w.oracle.expected[0])+1]}}),/Incorrect result/);
 const data=row('numeric-values-in-wat','little-endian-i64');
 assert.equal((await nativeProposalCheck(data)).status,'verified');
 const memory=structuredClone(data.oracle.memory);memory[0].hex='00'+memory[0].hex.slice(2);
 await assert.rejects(nativeProposalCheck({...data,oracle:{...data.oracle,memory}}),/Incorrect memory bytes/);
 const roots=row('custom-descriptors','payload-read');
 const f=fixtures().find(f=>f.feature==='custom-descriptors'&&f.name==='payload-read');
 await assert.rejects(nativeProposalCheck({...roots,args:[64],oracle:{kind:'exact_u64',expected:[f.expected(64)]},retainedRoots:{multiplier:999}}),/Incorrect retained root value/);
});

test('metadata checker rejects a hint referencing a non-branch byte',async()=>{
 const f=fixtures().find(f=>f.feature==='branch-hinting');
 const w=row(f.feature,f.name),bytes=await readFile(w.artifact);
 assert.ok(checkProposalMetadata(f,bytes));
 const bad=Buffer.from(bytes),label=Buffer.from('metadata.code.branch_hint');
 const payload=bad.indexOf(label)+label.length;
 assert.ok(payload>=label.length);
 // count=1, function=0, hints=1, offset; byte zero of this body is locals.
 bad[payload+3]=0;
 assert.throws(()=>checkProposalMetadata(f,bad),/Hint must reference/);
});

test('unavailable classification never hides wrong results or runtime memory faults',()=>{
 assert.equal(unavailableProposal('memory-control','CompileError: WebAssembly.Module(): invalid numeric opcode: 0xfc12 @+77'),true);
 assert.equal(unavailableProposal('shared-everything-threads','CompileError: WebAssembly.Module(): shared globals are not supported yet @+24'),true);
 for(const message of ['RuntimeError: invalid memory access','Incorrect result features/memory-control/first-page: 1 expected 0','Artifact digest mismatch','CompileError: invalid type index'])
  assert.equal(unavailableProposal('memory-control',message),false,message);
});

test('full upstream inventory records complete file identities without a selection quota',async()=>{
 const index=JSON.parse(await readFile(join(root,'upstream/full-suite-index.json')));
 assert.equal(index.suites.length,proposalSuites.length);
 for(const suite of index.suites) {
  const pin=proposalSuites.find(s=>s.id===suite.id);
  assert.equal(suite.revision,pin.revision);assert.equal(suite.archiveSha256,pin.archiveSha256);
  assert.equal(new Set(suite.files.map(f=>f.path)).size,suite.files.length);
  assert.ok(suite.files.length>0);
  for(const file of suite.files){assert.match(file.sha256,/^[a-f0-9]{64}$/);assert.ok(!file.path.includes('..'));}
 }
});

test('upstream runner retains required native flags, dependencies and spec error policy',()=>{
 const v8=v8TestArguments('test/mjsunit/wasm/example.js','// Flags: --wasm-shared\n// Files: test/mjsunit/wasm/wasm-module-builder.js\n// Environment Variables: X=value=1\n');
 assert.ok(v8.args.includes('--wasm-shared'));assert.ok(v8.args.includes('test/mjsunit/mjsunit.js'));
 assert.ok(v8.args.includes('test/mjsunit/wasm/wasm-module-builder.js'));assert.equal(v8.env.X,'value=1');
 assert.ok(!v8TestArguments('a.js','// NO HARNESS\n').args.includes('test/mjsunit/mjsunit.js'));
 assert.ok(wasmtimeTestFlags('spec','array.wast','').flags.includes('--ignore-error-messages'));
 assert.ok(wasmtimeTestFlags('component','values/trap-in-post-return.wast','').flags.includes('component-model-async=true'));
 const nan=wasmtimeTestFlags('wasmtime','nan.wast',';;! nan_canonicalization = true\n');
 assert.ok(nan.flags.includes('nan-canonicalization=true'));assert.ok(!nan.flags.includes('-O'));
});
