import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { site, digest, command } from './lib/wasmbench.mjs';
import { applicationWorkloads } from './lib/application-manifest.mjs';
import { workloadCategory, compareWorkloads, algorithmCoverage } from './lib/workload-category.mjs';
import { prepareCorpus, parseCorpusJSON } from './lib/corpus.mjs';

test('combined manifests retain raw 64-bit upstream metadata without rounding',()=>{
  const data=parseCorpusJSON('{"original_contract":{"command":{"want":[4731344651406016513,18446744073709551615]}},"oracle":{"expected":["18446744073709551615"]},"size":64}');
  assert.deepEqual(data.original_contract.command.want,['4731344651406016513','18446744073709551615']);
  assert.equal(data.oracle.expected[0],'18446744073709551615');assert.equal(data.size,64);
});

test('every committed application algorithm matches independent reference and reused-state execution',()=>{
  command(process.execPath,['scripts/application-corpus.mjs','check','--v8-only']);
});
test('application importer rejects changed bytes, unknown subsets, and escaped paths',async()=>{
  const root=await mkdtemp(join(tmpdir(),'wasm-fyi-apps-'));
  try {
    await mkdir(join(root,'sources'));await mkdir(join(root,'artifacts'));
    const fixture=JSON.parse(await readFile(join(site,'corpora/applications/manifest.json')))[0];
    const bytes=await readFile(join(site,'corpora/applications',fixture.artifact));
    await writeFile(join(root,fixture.artifact),bytes);
    await writeFile(join(root,fixture.provenance.recipe.source),await readFile(join(site,'corpora/applications',fixture.provenance.recipe.source)));
    const path=join(root,'manifest.json');await writeFile(path,JSON.stringify([fixture]));
    assert.equal((await applicationWorkloads(path))[0].artifact,join(root,fixture.artifact));
    await assert.rejects(applicationWorkloads(path,['applications/unknown']),/unique configured IDs/);
    await assert.rejects(applicationWorkloads(path,[fixture.id,fixture.id]),/unique configured IDs/);
    await writeFile(join(root,fixture.artifact),'changed');
    await assert.rejects(applicationWorkloads(path),/artifact digest mismatch/);
    await writeFile(join(root,fixture.artifact),bytes);
    await writeFile(join(root,fixture.provenance.recipe.source),'changed');
    await assert.rejects(applicationWorkloads(path),/source digest mismatch/);
    fixture.artifact='../outside.wasm';await writeFile(path,JSON.stringify([fixture]));
    await assert.rejects(applicationWorkloads(path),/Unsafe application path/);
  } finally {await rm(root,{recursive:true,force:true});}
});
test('explicit upstream subsets do not accidentally start the full application suite',async()=>{
  const root=await mkdtemp(join(tmpdir(),'wasm-fyi-combine-'));
  const saved=process.env.WASMBENCH_CORPUS_IDS;
  try {
    const settings={collection:{suite:'wago',wagoSource:'unused'},corpus:{source:'wago',ids:['tiny'],applications:'corpora/applications/manifest.json'}};
    const run=(...args)=>{const path=args[args.indexOf('--out')+1];command(process.execPath,['-e',`require('fs').writeFileSync(process.argv[1],JSON.stringify([{id:'wago/tiny/add',sha256:'${'a'.repeat(64)}'}]))`,path]);return '';};
    process.env.WASMBENCH_CORPUS_IDS='tiny';
    const subset=JSON.parse(await readFile(await prepareCorpus(settings,run,join(root,'subset'))));
    assert.equal(subset.length,1);
    delete process.env.WASMBENCH_CORPUS_IDS;
    const full=JSON.parse(await readFile(await prepareCorpus(settings,run,join(root,'full'))));
    assert.equal(full.length,103);
    assert(full.filter(w=>w.id.startsWith('applications/')).every(w=>w.artifact.startsWith(site)));
  } finally {
    if(saved===undefined)delete process.env.WASMBENCH_CORPUS_IDS;else process.env.WASMBENCH_CORPUS_IDS=saved;
    await rm(root,{recursive:true,force:true});
  }
});
test('all prepared contracts have categories; probes sort last and counts never imply support',async()=>{
  const catalog=JSON.parse(await readFile(join(site,'corpora/catalog.json')));
  assert.equal(catalog.workloads.length,166);assert.equal(catalog.categories.length,27);
  assert.equal(catalog.readyContracts,166);
  assert(catalog.workloads.filter(w=>w.status==='adapter-needed').every(w=>w.reason&&w.oracle.kind==='unsupported'));
  assert(catalog.workloads.every(w=>!w.id.startsWith('wago/')));
  const ws=await applicationWorkloads('corpora/applications/manifest.json');
  assert(ws.every(w=>workloadCategory(w)===w.provenance.category));
  const sorted=[{id:'features/core-num/test',group:'Features'},{id:ws[0].id,group:workloadCategory(ws[0])}].sort(compareWorkloads);
  assert(sorted.at(-1).id.startsWith('features/'));
  assert.equal(new Set(catalog.workloads.map(w=>w.algorithm)).size,catalog.workloads.length);
  assert(catalog.categories.every(c=>c.contracts>=6&&c.contracts<=9));
  assert(ws.every(w=>!/^applications\/.+\/\d+$/.test(w.id)));
});

test('coverage rejects size padding and categories with too few or too many algorithms',()=>{
  const workloads=Array.from({length:6},(_,i)=>({id:`applications/algorithm-${i}`,provenance:{algorithm:`algorithm-${i}`,category:'Image editing'}}));
  assert.equal(algorithmCoverage(workloads).get('Image editing').length,6);
  assert.throws(()=>algorithmCoverage([...workloads,{...workloads[0],id:'applications/algorithm-0/1024'}]),/Duplicate or missing algorithm/);
  assert.throws(()=>algorithmCoverage(workloads.slice(0,5)),/expected 6–9/);
  assert.throws(()=>algorithmCoverage(Array.from({length:10},(_,i)=>({...workloads[0],id:`applications/a${i}`,provenance:{category:'Image editing',algorithm:`a${i}`}}))),/expected 6–9/);
});

test('curated upstream imports retain one selected export per algorithm',async()=>{
  const root=await mkdtemp(join(tmpdir(),'wasm-fyi-selection-'));
  const saved=process.env.WASMBENCH_CORPUS_IDS;
  try {
    const settings={collection:{suite:'wago',wagoSource:'unused'},corpus:{source:'wago',ids:['tiny'],selection:'corpora/selection.json',applications:'corpora/applications/manifest.json'}};
    const run=(...args)=>{const path=args[args.indexOf('--out')+1];command(process.execPath,['-e',`require('fs').writeFileSync(process.argv[1],JSON.stringify(['add','unselected-export'].map(name=>({id:'wago/tiny/'+name,sha256:'${'a'.repeat(64)}'}))))`,path]);return '';};
    process.env.WASMBENCH_CORPUS_IDS='tiny';
    const selected=JSON.parse(await readFile(await prepareCorpus(settings,run,root)));
    assert.deepEqual(selected.map(w=>w.id),['wago/tiny/add']);
    assert.equal(selected[0].provenance.algorithm,'core-call');
    assert.equal(selected[0].provenance.category,'Calls & memory');
  } finally {
    if(saved===undefined)delete process.env.WASMBENCH_CORPUS_IDS;else process.env.WASMBENCH_CORPUS_IDS=saved;
    await rm(root,{recursive:true,force:true});
  }
});
