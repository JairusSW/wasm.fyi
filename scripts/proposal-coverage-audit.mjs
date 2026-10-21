import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fixtures} from '../corpora/features/generator.mjs';
import {proposalGapIds} from '../corpora/features/proposal-gaps.mjs';
import {proposalBinaryIds} from '../corpora/features/proposal-binary.mjs';
import {site,digest} from './lib/wasmbench.mjs';
import {PROPOSAL_VALIDATION_SIZES,unavailableProposal} from './lib/proposal-validation.mjs';
import {performanceSource,repeatedFeatureSource,FEATURE_PERFORMANCE_REPEATS} from './lib/feature-performance.mjs';
import {proposalBinaryBytes} from '../corpora/features/proposal-binary.mjs';

const root=join(site,'corpora/features'),reportRoot=join(root,'reports');
const read=async path=>JSON.parse(await readFile(path));
const snapshot=await read(join(site,'src/lib/data/proposals.json'));
const generated=fixtures(),newFamilies=new Set([...proposalGapIds,...proposalBinaryIds]);
const source=await readFile(join(site,'src/lib/data/features.ts'),'utf8');
const aliases=new Map([...source.slice(source.indexOf('const KNOWN'),source.indexOf('/** Group order')).matchAll(/\b(\w+): \{ id: '([^']+)'/g)].map(m=>[m[1],m[2]]));
const evidence=await read(join(reportRoot,'proposal-correctness.json'));
const performance=await read(join(reportRoot,'proposal-performance-correctness.json'));
const performanceBuild=await read(join(reportRoot,'proposal-performance-build.json'));
const host=await read(join(reportRoot,'host-correctness.json'));
const embedding=await read(join(root,'host-proposals/manifest.json'));
const index=await read(join(root,'upstream/full-suite-index.json'));
const officialV8=await read(join(reportRoot,'upstream-v8-official.json'));
const sourceManifest=await read(join(root,'manifest.json'));
const newFixtures=generated.filter(f=>newFamilies.has(f.feature));
if(evidence.outcomes.length!==newFixtures.length)throw Error('Incomplete original proposal verification');
for(const f of newFixtures) {
 const id=`features/${f.feature}/${f.name}/${f.sizes[0]}`;
 const w=sourceManifest.find(w=>w.id===id),o=evidence.outcomes.find(o=>o.id===id);
 if(!w||!o||o.sha256!==w.sha256||digest(await readFile(join(root,w.artifact)))!==o.sha256||digest(await readFile(join(root,w.source)))!==o.sourceSha256)throw Error('Stale proposal proof '+id);
 const expected=PROPOSAL_VALIDATION_SIZES.map(n=>({args:f.args?f.args(n):[n],expected:[f.expected(n)]}));
 if(JSON.stringify(o.vectors)!==JSON.stringify(expected))throw Error('Changed proposal oracle vectors '+id);
 if(o.status==='unavailable'&&!unavailableProposal(f.feature,o.reason))throw Error('Unqualified unavailable result '+id);
}
const executable=newFixtures.filter(f=>!['compile-only','compile-and-instantiate'].includes(f.scope));
if(performance.outcomes.length!==executable.length)throw Error('Incomplete performance verification');
for(const f of executable) {
 const o=performance.outcomes.find(o=>o.id.startsWith(`features/${f.feature}/${f.name}/`)),n=Math.max(...f.sizes);
 const expected=[{args:f.args?f.args(n):[n],expected:[f.hostBoundary?f.expected(n):Number(BigInt.asUintN(32,BigInt(f.expected(n))*BigInt(FEATURE_PERFORMANCE_REPEATS)))]}];
 if(!o||JSON.stringify(o.vectors)!==JSON.stringify(expected))throw Error('Changed performance oracle '+f.name);
 const source=f.hostBoundary?f.wat:f.performanceWat?f.performanceWat():repeatedFeatureSource(performanceSource(f).wat);
 const recipe=performanceBuild.recipes.find(r=>r.source.endsWith(`/${f.feature}-${f.name}.wat`));
 const original=sourceManifest.find(w=>w.id===`features/${f.feature}/${f.name}/${n}`);
 if(!recipe||recipe.sha256!==o.sha256||recipe.originalArtifactSha256!==original?.sha256||digest(source.trim()+'\n')!==o.sourceSha256)throw Error('Stale performance source/artifact proof '+f.name);
 if(f.nativeValidation&&digest(proposalBinaryBytes(source))!==o.sha256)throw Error('Changed binary performance artifact '+f.name);
 if(o.status==='unavailable'&&!unavailableProposal(f.feature,o.reason))throw Error('Unqualified unavailable performance result '+f.name);
}
for(const c of embedding.contracts) {
 if(digest(await readFile(join(site,c.source)))!==c.sourceSha256)throw Error('Stale embedding source '+c.id);
 if(c.artifact&&digest(await readFile(join(site,c.artifact)))!==c.sha256)throw Error('Stale embedding artifact '+c.id);
}
const nativePerformance=await read(join(reportRoot,'host-performance-correctness.json'));
if(nativePerformance.manifestSha256!==digest(await readFile(join(root,'host-proposals/manifest.json'))))throw Error('Stale native performance proof');
if(nativePerformance.outcomes.length!==embedding.contracts.filter(c=>c.performance).length||nativePerformance.outcomes.some(o=>o.status!=='verified'))throw Error('Incomplete native performance proof');
if(JSON.stringify(nativePerformance.outcomes.map(o=>o.id).sort())!==JSON.stringify(embedding.contracts.filter(c=>c.performance).map(c=>c.id).sort()))throw Error('Changed native performance inventory');
const v8=index.suites.find(s=>s.id==='v8-15.2.20');
if(officialV8.status!=='passed'||officialV8.upstream.test_total<=0||officialV8.totals.PASS!==officialV8.upstream.test_total||officialV8.suite.revision!==v8.revision||officialV8.suite.inventorySha256!==digest(JSON.stringify(v8.files)))throw Error('Incomplete or stale official V8 qualification');
let liveIdentity=null;
const website=process.argv.find(a=>a.startsWith('--website-snapshot='))?.slice(19);
if(website) {
 const live=await read(website);
 const identities=Object.entries(live.features).map(([key,f])=>({key,name:f.description,url:f.url,phase:f.phase})).sort((a,b)=>a.key.localeCompare(b.key));
 const retained=snapshot.proposals.map(({key,name,url,phase})=>({key,name,url,phase})).sort((a,b)=>a.key.localeCompare(b.key));
 if(JSON.stringify(identities)!==JSON.stringify(retained))throw Error('Proposal snapshot no longer matches the supplied live website data');
 liveIdentity={verified:new Date().toISOString(),source:'https://raw.githubusercontent.com/WebAssembly/website/main/features.json',identitySha256:digest(JSON.stringify(identities)),identities};
}
const gaps={
 flexibleVectors:'No runnable variable-width vector instruction implementation or qualified adapter was found in the pinned V8/Wasmtime sources; fixed-width SIMD does not qualify.',
 frozenValues:'No native frozen-value API/opcode or qualified upstream runner in the pinned engines; ordinary immutable globals/structs do not qualify.',
 jitInterface:'No qualified JIT-interface host implementation/runner in this environment; ordinary WebAssembly.compile does not qualify.',
 jsPrimitiveBuiltins:'No native JS primitive builtins binding in the pinned engines; JS polyfills do not qualify.',
 moreArrayConstructors:'No runnable implementation of the proposed additional constructors in the pinned engines; existing GC array constructors do not qualify.',
 multibyteArrayAccess:'No implementation of the proposed multibyte array accesses in the pinned engines; linear-memory loads do not qualify.',
 profiles:'Profile conformance needs a profile-specific validator and profile definition. An engine accepting ordinary Wasm is not evidence of a profile, and there is no profile-specific execution opcode to time.',
 relaxedDeadCodeValidation:'No qualified implementation/feature switch for the relaxed validator in the pinned engines. Existing unreachable-code tests exercise current validation rules and do not qualify.',
 roundingVariants:'The feature page advertises an assembler (watr); neither pinned execution engine implements these rounding-variant opcodes. Ordinary ceil/floor oracles do not substitute for executing the proposal.',
 typeImports:'No qualified implementation of imported abstract types in the pinned engines; ordinary imported functions/types do not qualify.',
};
const rows=[];
for(const proposal of snapshot.proposals) {
 const id=aliases.get(proposal.key)||proposal.key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());
 const programs=generated.filter(f=>f.feature===id&&!f.baseline);
 const outcomes=evidence.outcomes.filter(o=>o.id.startsWith('features/'+id+'/'));
 const perf=performance.outcomes.filter(o=>o.id.startsWith('features/'+id+'/'));
 const hosts=embedding.contracts.filter(c=>c.feature===id);
 const limits=[];
 if(gaps[proposal.key])limits.push(gaps[proposal.key]);
 if(id==='acquire-release-atomics')limits.push('The encoder and runtime pin V8 15.2.20, which uses memarg bit 5 for ordering. The current proposal Overview uses bit 4; that newer wire format is not qualified here. Single-agent RMW checks do not prove inter-thread memory ordering.');
 if(id==='shared-everything-threads')limits.push('Shared struct atomics execute; shared globals are rejected by this V8. Original kernels test single-agent semantics; concurrent coverage remains in the full upstream suite.');
 if(id==='memory-control')limits.push('memory.discard compiles with wasm-tools but neither local execution engine implements it. V8 exposes MemoryMapDescriptor but cannot create one on this host; file-backed mapping helpers are absent. All these probes remain unverified.');
 if(id==='instrument-and-tracing-technology')limits.push('Metadata bytes/offsets and unchanged results are verified. V8 emits native trace markers only on x64; native trace emission is unverified on this ARM64 host.');
 if(id==='web-content-security-policy')limits.push('Chrome 155 aborts with SIGABRT before loading any page, including an independent about:blank preflight. Browser CSP source contracts are staged but unverified in this environment.');
 if(id==='wasm-c-api')limits.push('Five native kernels pass. The portable table-reference case is retained as unavailable: this Wasmtime C library reports wasm_func_as_ref as unimplemented. All 12 shipped C examples execute, separately from the Rust API test matrix.');
 if(id==='compilation-hints'||id==='branch-hinting')limits.push('Original kernels verify metadata and result preservation. Successful execution alone is not evidence that an engine honored a performance hint; upstream native tests are retained separately.');
 if(['numeric-values-in-wat','custom-annotation-syntax-in-the-text-format'].includes(id))limits.push('This is text-assembler syntax. Binary compile/instantiate probes are semantic controls; syntax throughput must be measured in the pinned text assembler, not attributed to core runtime execution.');
 const execution=programs.filter(f=>!['compile-only','compile-and-instantiate'].includes(f.scope));
 const verified=outcomes.filter(o=>o.status==='verified').length;
 const hostVerified=hosts.filter(c=>c.validation==='verified').length;
 rows.push({...proposal,id,newCorpus:newFamilies.has(id)||hosts.length>0,
  compatibility:{programs:programs.length,sizeContracts:programs.reduce((n,f)=>n+f.sizes.length,0),nativeEmbeddingPrograms:hosts.length,
   verifiedPrograms:verified,verifiedEmbeddingPrograms:hostVerified,verification:newFamilies.has(id)?'see retained exact-artifact report':programs.length?'existing corpus; not requalified by this change':'see embedding evidence or explicit gap'},
  performance:{executionPrograms:execution.length,compileOrInstantiatePrograms:programs.length-execution.length,
   verifiedExecutionPrograms:perf.filter(o=>o.status==='verified').length,unavailableExecutionPrograms:perf.filter(o=>o.status==='unavailable').length,
   verifiedNativeEmbeddingPrograms:hosts.filter(c=>c.performance).length},
  status:gaps[proposal.key]?'gap':limits.some(l=>/unverified|unavailable|not qualified|rejected/i.test(l))?'partial':verified||hostVerified?'verified-corpus':'existing-corpus',
  limitations:limits});
}
const suites=[];
for(const suite of index.suites) {
 const report=await read(join(reportRoot,'upstream-'+suite.id+'.json'));
 if(report.results.length!==suite.files.length)throw Error('Incomplete attempted inventory '+suite.id);
 const actual=report.results.map(({path,sha256})=>({path,sha256}));
 if(JSON.stringify(actual)!==JSON.stringify(suite.files))throw Error('Upstream result/source inventory mismatch '+suite.id);
 suites.push({id:suite.id,repository:suite.repository,revision:suite.revision,files:suite.files.length,totals:report.totals,
  sourceInventorySha256:digest(JSON.stringify(actual)),report:'reports/upstream-'+suite.id+'.json'});
}
const result={schema:1,created:new Date().toISOString(),proposalSource:snapshot.source,proposalSnapshotRetrieved:snapshot.retrieved,liveIdentity,
 policy:'Every proposal is accounted for, including inactive entries. No compatibility quota or cap. Programs, size variants, embedding API cases and upstream files remain separate counts. Corpus verification does not assert support by every engine or publish performance measurements.',
 host:host.host,suites,officialV8:{status:officialV8.status,tests:officialV8.upstream.test_total,totals:officialV8.totals,
  report:'reports/upstream-v8-official.json',policy:officialV8.policy},proposals:rows};
await mkdir(reportRoot,{recursive:true});await writeFile(join(root,'proposal-coverage.json'),JSON.stringify(result,null,2)+'\n');
console.log(`${rows.length} proposals: ${rows.filter(r=>r.status==='gap').length} explicit gaps, ${rows.filter(r=>r.status==='partial').length} partial; ${suites.reduce((n,s)=>n+s.files,0)} upstream files have outcomes.`);
