import { readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { harness, site, digest } from './lib/wasmbench.mjs';
import { prepareCorpus } from './lib/corpus.mjs';
import { workloadCategory, algorithmCoverage } from './lib/workload-category.mjs';

if(process.env.WASMBENCH_CORPUS_IDS || process.env.WASMBENCH_APPLICATION_IDS || process.env.WASMBENCH_SUITE)throw Error('Corpus audit requires the complete configured inventory');
const {settings,run}=await harness();
const manifest=await prepareCorpus(settings,run);
const ws=JSON.parse(await readFile(manifest));
const groups=algorithmCoverage(ws);
const source=resolve(site,settings.collection.wagoSource);
const upstream=await readFile(join(source,'corpus/catalog.json'));
const catalog={schema:1,policy:'Prepared corpus inventory, not measured performance. Unsupported contracts remain visible. One representative input per algorithm; every use-case category has 6–9 distinct algorithms. Feature probes are separate and excluded from application averages.',
  upstreamCatalogSha256:digest(upstream),upstreamBenchmarks:settings.corpus.ids.length,
  applicationContracts:ws.length,readyContracts:ws.filter(w=>!w.unsupported_reason).length,
  categories:[...groups].sort(([a],[b])=>a.localeCompare(b)).map(([category,items])=>({category,contracts:items.length,ready:items.filter(w=>!w.unsupported_reason).length})),
  boundaries:[
    'CPU kernels represent the specified operations, not whole applications or user-visible frame rates.',
    'Graphics workloads measure CPU geometry, image processing and software rendering; WebGL/WebGPU drivers and GPU throughput are outside engine comparison.',
    'Command workloads require declared WASI/Emscripten host contracts; missing adapters are explicit, not inferred from feature compatibility.',
    'Filesystem fixtures are deterministic sandbox inputs, not disk or network throughput. Browser DOM, network latency and UI integration require host-specific end-to-end suites.',
    'Video motion estimation and audio DSP are processing kernels; this corpus does not claim complete video-codec, speech recognition or font-shaping coverage.'
  ],
  workloads:await Promise.all(ws.map(async w=>({id:w.id.replace(/^(wago|applications)\//,''),contractId:w.id,algorithm:w.provenance.algorithm,category:workloadCategory(w),sha256:w.sha256,artifactBytes:(await readFile(w.artifact)).length,
    kind:w.provenance?.kind || (w.original_contract?.command?'application':w.original_contract?.tags?.includes('semantic')?'library':'kernel'),
    description:w.provenance?.description || w.original_contract?.desc || w.work_unit,
    abi:w.abi,workUnit:w.work_unit,unitsPerInvocation:w.units_per_invocation,args:w.args,reset:w.reset,
    originalContract:w.original_contract || null,oracle:w.oracle,license:w.license,source:w.original_contract?.source || w.provenance?.recipe || w.source,
    status:w.unsupported_reason?'adapter-needed':'prepared',reason:w.unsupported_reason || null}))) };
if(process.argv.includes('--check')) {
  const stored=JSON.parse(await readFile(join(site,'corpora/catalog.json')));
  if(JSON.stringify(stored)!==JSON.stringify(catalog))throw Error('Corpus inventory drifted; run just corpus-audit and review changes');
} else await writeFile(join(site,'corpora/catalog.json'),JSON.stringify(catalog,null,2)+'\n');
console.log(catalog.categories.map(c=>`${c.category}: ${c.ready}/${c.contracts} prepared`).join('\n'));
console.log(`${ws.length} contracts, ${catalog.categories.length} categories; ${catalog.readyContracts} ready, ${ws.length-catalog.readyContracts} require adapters. Imported manifest: ${relative(site,manifest)}`);
