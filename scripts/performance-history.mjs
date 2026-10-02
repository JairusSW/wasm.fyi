import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {site,harness,digest,command} from './lib/wasmbench.mjs';
import {prepareCorpus,parseCorpusJSON} from './lib/corpus.mjs';
import {performanceHistoryQueue,performanceCorpusIdentity} from './lib/performance-history.mjs';
import {engineSources} from './lib/engine-sources.mjs';

if((process.argv[2] || 'plan')!=='plan')throw Error('Usage: performance-history.mjs plan');
if(process.env.WASMBENCH_CORPUS_IDS || process.env.WASMBENCH_APPLICATION_IDS)throw Error('Performance history requires the complete corpus');
const {root,settings,run}=await harness();
const directory=join(site,'.wasmbench/performance-history');await mkdir(directory,{recursive:true});
const plan=JSON.parse(await readFile(join(site,'data/release-history/plan.json')));
for(const targetWeek of plan.weeks)for(const engine of Object.keys(engineSources)) {
  if(plan.pins.filter(p=>p.targetWeek===targetWeek&&p.engine===engine).length!==1)throw Error('Release plan is missing a unique engine/Wednesday: '+engine+'/'+targetWeek);
}
process.env.WASMBENCH_SUITE='all';
const manifest=process.env.WASMBENCH_HISTORY_SUITE?resolve(process.env.WASMBENCH_HISTORY_SUITE):await prepareCorpus(settings,run,join(directory,'corpus'));
const workloads=parseCorpusJSON(await readFile(manifest,'utf8'));
const catalog=JSON.parse(await readFile(join(site,'corpora/catalog.json')));
const features=JSON.parse(await readFile(join(site,'corpora/features/manifest.json')));
const required=new Set([...catalog.workloads.map(w=>w.contractId),...features.map(w=>w.id)]);
if(workloads.length!==required.size || workloads.some(w=>!required.has(w.id)) || new Set(workloads.map(w=>w.id)).size!==required.size)throw Error('Historical performance suite must contain every application and feature contract');
// Verify pinned artifacts now. A collector must repeat this check before running.
for(const w of workloads)if(digest(await readFile(resolve(w.artifact)))!==w.sha256)throw Error('Historical corpus bytes changed: '+w.id);
async function recipeFiles(directory) {
  const files=[];
  for(const entry of await readdir(join(site,directory),{withFileTypes:true})) {
    if(['target','node_modules','.git','.wasmbench'].includes(entry.name))continue;
    const path=join(directory,entry.name);
    if(entry.isDirectory())files.push(...await recipeFiles(path));
    else if(/\.(?:go|rs|c|cc|cpp|h|mjs|js|java|toml|lock|mod|sum|patch|json|go\.txt)$/.test(path))files.push(path);
  }
  return files;
}
const siteFiles=(await Promise.all(['scripts','adapters','patches'].map(recipeFiles))).flat();
const harnessFiles=command('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root}).toString().split('\0').filter(p=>/\.(?:go|rs|c|cc|cpp|h|mjs|js|toml|lock|mod|sum)$/.test(p));
const inputs=await Promise.all([...siteFiles.map(p=>['site/'+p,join(site,p)]),...harnessFiles.map(p=>['harness/'+p,join(root,p)])]
  .sort(([a],[b])=>a.localeCompare(b)).map(async([path,file])=>({path,sha256:digest(await readFile(file))})));
const recipeSha256=digest(JSON.stringify({inputs,toolchainPins:{node:settings.node,features:settings.featureTools}}));
const options={launches:settings.collection.launches,samples:settings.collection.samples,operations:settings.collection.operations,warmup:settings.collection.warmup,
  timeout:'300s',validationProfile:'all',memory:settings.collection.memory,code:settings.collection.code,phaseBarriers:settings.collection.phaseBarriers};
const queue=performanceHistoryQueue(plan,{host:process.platform+'/'+process.arch,corpusSha256:performanceCorpusIdentity(workloads),recipeSha256,options});
await writeFile(join(directory,'queue.json'),JSON.stringify({...queue,created:new Date().toISOString(),suite:manifest,workloads:workloads.length,recipeInputs:inputs,policy:plan.policy},null,2)+'\n');
console.log(`${queue.jobs.length} distinct released-engine jobs for ${plan.weeks.length} Wednesdays; ${queue.snapshots.filter(s=>s.status==='unavailable').length} unavailable release points; ${workloads.length} workloads per job.`);
console.log('Queue prepared; no historical performance measurements are claimed by this planning step.');
