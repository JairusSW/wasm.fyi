import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { applicationWorkloads } from './application-manifest.mjs';
import { site, digest } from './wasmbench.mjs';

// Protocol values are already decimal strings, but retained upstream contracts
// can contain raw 64-bit JSON integers. Preserve their token before reserializing.
export function parseCorpusJSON(text) {
  return JSON.parse(text, (_key,value,context)=>{
    if(typeof value==='number' && Number.isInteger(value) && !Number.isSafeInteger(value)) {
      if(!context?.source)throw Error('Exact corpus parsing requires JSON source-context support');
      return context.source;
    }
    return value;
  });
}

export async function prepareCorpus(settings, run, directory) {
  const selected = process.env.WASMBENCH_SUITE || settings.collection.suite;
  if (selected !== 'wago' && selected !== 'all') return selected.endsWith('.json') ? resolve(site, selected) : selected;
  const corpus = settings.corpus;
  if (corpus?.source !== 'wago' || !Array.isArray(corpus.ids) || !corpus.ids.length) throw new Error('Configure the Wago corpus selection');
  const ids = process.env.WASMBENCH_CORPUS_IDS ? process.env.WASMBENCH_CORPUS_IDS.split(',') : corpus.ids;
  if (ids.some(id => !corpus.ids.includes(id)) || new Set(ids).size !== ids.length) throw new Error('Corpus override must select unique configured Wago IDs');
  const source = resolve(site, process.env.WASMBENCH_CORPUS_SOURCE || process.env.WAGO_SOURCE || settings.collection.wagoSource);
  const output = directory || join(site, '.wasmbench/corpora', new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8));
  await mkdir(output, { recursive: true });
  const manifest = join(output, 'wago-suite.json');
  let workloads;
  if(corpus.buildManifest) {
    let retained;
    try{retained=parseCorpusJSON(await readFile(resolve(site,corpus.buildManifest),'utf8'));}
    catch(error){if(error.code==='ENOENT')throw Error('Run just corpus-build-all to compile the complete corpus from source before collection');throw error;}
    if(!Array.isArray(retained)||retained.length!==corpus.ids.length||new Set(retained.map(w=>w.id.split('/')[1])).size!==corpus.ids.length||corpus.ids.some(id=>!retained.some(w=>w.id.split('/')[1]===id)))throw Error('Incomplete source-built upstream corpus');
    workloads=retained.filter(w=>ids.includes(w.id.split('/')[1]));
    for(const w of workloads)if(digest(await readFile(w.artifact))!==w.sha256)throw Error('Source-built artifact digest mismatch: '+w.id);
  } else {
    process.stdout.write(run('import-wago', '--source', source, '--ids', ids.join(','), '--out', manifest));
    workloads=parseCorpusJSON(await readFile(manifest,'utf8'));
  }
  if (!Array.isArray(workloads) || !workloads.length || new Set(workloads.map(w => w.id)).size !== workloads.length) throw new Error('Invalid imported corpus');
  if(corpus.selection) {
    const selection=JSON.parse(await readFile(resolve(site,corpus.selection),'utf8'));
    if(selection.schema!==1 || !Array.isArray(selection.workloads))throw Error('Invalid algorithm selection');
    const choices=new Map(selection.workloads.map(w=>[w.id,w]));
    if(choices.size!==selection.workloads.length)throw Error('Duplicate selected contract');
    const expected=selection.workloads.filter(w=>ids.includes(w.id.split('/')[1]));
    workloads=workloads.filter(w=>choices.has(w.id)).map(w=>({...w,provenance:{...w.provenance,algorithm:choices.get(w.id).algorithm,category:choices.get(w.id).category}}));
    if(expected.some(w=>!workloads.some(actual=>actual.id===w.id)))throw Error('Selected algorithm contract missing from upstream import');
  }
  // Explicit Wago subsets remain bounded; opt applications in with their own IDs.
  const applicationIds = process.env.WASMBENCH_APPLICATION_IDS?.split(',').filter(Boolean);
  const applications = process.env.WASMBENCH_CORPUS_IDS && applicationIds === undefined ? [] : await applicationWorkloads(corpus.applications, applicationIds);
  workloads.push(...applications);
  if(selected==='all') {
    const featuresRoot=resolve(site,'corpora/features');
    const features=parseCorpusJSON(await readFile(join(featuresRoot,'manifest.json'),'utf8'));
    for(const w of features) {
      const artifact=resolve(featuresRoot,w.artifact);
      if(!artifact.startsWith(featuresRoot+'/'))throw Error('Unsafe feature artifact');
      if(digest(await readFile(artifact))!==w.sha256)throw Error('Feature artifact digest mismatch: '+w.id);
      workloads.push({...w,artifact});
    }
  }

  if(new Set(workloads.map(w=>w.id)).size!==workloads.length)throw Error('Duplicate combined corpus IDs');
  await writeFile(manifest, JSON.stringify(workloads, null, 2) + '\n');
  const summary = { source: 'wago + wasm.fyi application kernels', selectedBenchmarks: ids, applicationContracts: applications.length, workloadContracts: workloads.length,
    executable: workloads.filter(w => !w.unsupported_reason).length,
    unsupported: workloads.filter(w => w.unsupported_reason).map(w => ({ id: w.id, reason: w.unsupported_reason })),
    workloads: workloads.map(w => ({ id: w.id, sha256: w.sha256, abi: w.abi, license: w.license, source: w.source, provenance: w.provenance })) };
  await writeFile(join(output, 'corpus-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`Corpus: ${ids.length} upstream benchmarks + ${applications.length} application kernel contracts, ${workloads.length} contracts; ${summary.unsupported.length} explicitly unsupported contracts.`);
  return manifest;
}
