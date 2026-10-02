import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {site,digest,exists,command} from './lib/wasmbench.mjs';
import {wednesdays,weeklyPolicy} from './lib/weekly-history.mjs';
import {engineSources,pinEngine} from './lib/engine-sources.mjs';
import {historyLanes} from './lib/history-lanes.mjs';
const action=process.argv[2] || 'plan';
if(!['plan','collect'].includes(action))throw Error('Usage: history.mjs plan|collect');
const directory=join(site,'.wasmbench/release-history');await mkdir(directory,{recursive:true});
const previous=await readFile(join(directory,'results.json'),'utf8').then(JSON.parse,()=>({results:[]}));
const durable=join(site,'data/release-history');await mkdir(durable,{recursive:true});
const priorPlan=await readFile(join(durable,'plan.json'),'utf8').then(JSON.parse,()=>({weeks:[]}));
const dates=wednesdays(new Date(process.env.WASMBENCH_HISTORY_ANCHOR || Date.now()),Number(process.env.WASMBENCH_HISTORY_WEEKS || 8),[...previous.results,...priorPlan.weeks.map(targetWeek=>({targetWeek}))]);
// Resolve each upstream once. All fourteen engines remain in the inventory,
// including engines without a published release or a qualified runner.
const pins=[];for(const engine of Object.keys(engineSources))pins.push(...await pinEngine(engine,dates));
const plan={schema:2,created:new Date().toISOString(),policy:weeklyPolicy,weeks:dates,pins};
await writeFile(join(directory,'plan.json'),JSON.stringify(plan,null,2)+'\n');
await writeFile(join(durable,'plan.json'),JSON.stringify(plan,null,2)+'\n');
if(action==='plan')console.log(JSON.stringify(plan,null,2));
else {
  const recipeSha256=digest(Buffer.concat(await Promise.all(['scripts/history.mjs','scripts/lib/history-lanes.mjs','scripts/conformance.mjs','scripts/lib/conformance.mjs','scripts/lib/release-policy.mjs'].map(p=>readFile(join(site,p))))));
  const results=[];
  for(const targetWeek of dates){
    const {lanes,gaps}=historyLanes(pins,targetWeek,process.platform);
    const selectionSha256=digest(JSON.stringify({pins:pins.filter(p=>p.targetWeek===targetWeek),lanes,platform:process.platform,arch:process.arch}));
    const cached=previous.results.find(r=>r.targetWeek===targetWeek);
    if(cached?.recipeSha256===recipeSha256 && cached.selectionSha256===selectionSha256 && cached.status==='collected' && await exists(join(cached.report,'report.json')) && digest(await readFile(join(cached.report,'report.json')))===cached.sha256){results.push(cached);continue;}
    if(!lanes.length){
      results.push({targetWeek,recipeSha256,selectionSha256,status:'unavailable',gaps});
      await writeFile(join(directory,'results.json'),JSON.stringify({...plan,results},null,2)+'\n');
      continue;
    }
    const run=spawnSync(process.execPath,['scripts/conformance.mjs','collect'],{cwd:site,stdio:'inherit',env:{...process.env,WASMBENCH_RELEASE_AS_OF:targetWeek,WASMBENCH_CONFORMANCE_LANES:lanes.join(',')}});
    if(run.error)throw run.error;
    const report=(await readFile(join(site,'.wasmbench/latest-conformance-report.txt'),'utf8')).trim();
    const bytes=await readFile(join(report,'report.json')),evidence=JSON.parse(bytes);
    if(evidence.releaseAsOf!==targetWeek)throw Error('Historical release date does not match collected evidence');
    results.push({targetWeek,recipeSha256,selectionSha256,collectedAt:evidence.created,report,sha256:digest(bytes),status:run.status===0?'collected':'runner-error',gaps});
    await writeFile(join(directory,'results.json'),JSON.stringify({...plan,results},null,2)+'\n');
    command(process.execPath,['scripts/publish-conformance.mjs',report],{stdio:'inherit'});
  }
  await writeFile(join(directory,'results.json'),JSON.stringify({...plan,results},null,2)+'\n');
  console.log('Release conformance snapshots retained; performance history is not reconstructed by this runner.');
  if(results.some(r=>r.status==='runner-error' || r.gaps.length))process.exitCode=1;
}
