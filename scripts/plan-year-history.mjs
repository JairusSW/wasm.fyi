import {mkdir,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {engineSources,releaseInventory} from './lib/engine-sources.mjs';
import {saturdays,monthsBefore} from './lib/weekly-history.mjs';
import {nearestCommit,nearestCommitSearchUntil,everyVersion,historyEngineOrder} from './lib/history-scope.mjs';
import {atomicJSON} from './lib/benchmark-plan.mjs';
const exec=promisify(execFile),root=resolve(process.argv[2]),anchor=process.argv[3]||new Date().toISOString(),cutoff=process.argv[4]||monthsBefore(anchor,12),samples=Number(process.argv[5]||12);
const sourceCutoff=monthsBefore(anchor,12);
await mkdir(root,{recursive:true});const dates=saturdays(new Date(anchor),53).filter(d=>Date.parse(d)>=Date.parse(cutoff)).reverse();
const plan=await readFile(join(root,'source-plan.json'),'utf8').then(JSON.parse,()=>({schema:1,status:'planning',anchor,cutoff,zone:'America/New_York',samples,policy:'Closest default-branch commit to each Saturday 23:59 Eastern, plus every published version including prereleases, within one year. Ties use the earlier commit. Repeated exact revisions are benchmarked once per configuration.',order:historyEngineOrder,finishedEngines:[],engines:[],pins:[]}));
if(plan.anchor!==anchor)throw Error('History anchor changed');
async function api(path,paginate=false){const args=['api',...(paginate?['--paginate']:[]),path,'--jq','tojson'];const {stdout}=await exec('gh',args,{maxBuffer:64*1024*1024});const pages=stdout.trim().split('\n').filter(Boolean).map(JSON.parse);return paginate?pages.flat():pages[0]}
for(const engine of historyEngineOrder){
 if(plan.finishedEngines.includes(engine))continue;
 const spec=engineSources[engine],pins=[];
 try{const repo=await api('repos/'+spec.repository);const branch=repo.default_branch;
  for(let i=0;i<dates.length;i+=4){const batch=await Promise.all(dates.slice(i,i+4).map(async targetWeek=>{
   try{const before=await api(`repos/${spec.repository}/commits?sha=${encodeURIComponent(branch)}&until=${encodeURIComponent(targetWeek)}&per_page=1`);let candidates=before;const afterUntil=nearestCommitSearchUntil(before[0],targetWeek,{cutoff:sourceCutoff,anchor});if(Date.parse(afterUntil)>Date.parse(targetWeek)){const after=await api(`repos/${spec.repository}/commits?sha=${encodeURIComponent(branch)}&since=${encodeURIComponent(targetWeek)}&until=${encodeURIComponent(afterUntil)}&per_page=100`,true);candidates=[...before,...after]}
    const commit=nearestCommit(candidates,targetWeek,{cutoff:sourceCutoff,anchor});if(!commit)throw Error('No main-branch commit exists within the requested year');return {engine,targetType:'main',targetWeek,repository:spec.repository,branch,revision:commit.sha,committedAt:commit.commit.committer.date,url:commit.html_url,status:'planned',configurations:spec.configurations};
   }catch(error){return {engine,targetType:'main',targetWeek,repository:spec.repository,status:'unavailable',reason:String(error),configurations:spec.configurations}}}));pins.push(...batch);
  }
 }catch(error){pins.push(...dates.map(targetWeek=>({engine,targetType:'main',targetWeek,repository:spec.repository,status:'unavailable',reason:String(error),configurations:spec.configurations})))}
 try{const releases=everyVersion(await releaseInventory(engine),cutoff,anchor);pins.push(...releases.map(r=>({engine,targetType:'release',targetWeek:new Date(r.published_at).toISOString(),targetRelease:r.tag_name,repository:spec.repository,configurations:spec.configurations,status:'planned',tag:r.tag_name,publishedAt:r.published_at,prerelease:!!r.prerelease,url:r.html_url,embeddedV8:r.embeddedV8,datePrecision:r.datePrecision||'second',revision:r.revision,dateBasis:r.dateBasis,versionTime:r.versionTime})))}catch(error){pins.push({engine,targetType:'release',status:'unavailable',reason:String(error),repository:spec.repository,configurations:spec.configurations})}
 pins.sort((a,b)=>Date.parse(b.targetWeek)-Date.parse(a.targetWeek));plan.pins.push(...pins);plan.finishedEngines.push(engine);plan.engines.push({engine,repository:spec.repository,configurations:spec.configurations,planned:pins.filter(p=>p.status==='planned').length,gaps:pins.filter(p=>p.status!=='planned').length});await atomicJSON(join(root,'source-plan.json'),plan);console.log(JSON.stringify(plan.engines.at(-1)));
}
plan.status='planned';await atomicJSON(join(root,'source-plan.json'),plan);
