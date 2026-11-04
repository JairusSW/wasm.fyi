// Resolve the current partial week's immutable pins for a resumable fleet run.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {engineSources,releaseInventory} from './lib/engine-sources.mjs';
import {historyEngineOrder} from './lib/history-scope.mjs';
import {newWeeklyPlan,planWeeklyEngine} from './lib/weekly-source-plan.mjs';
const directory=resolve(process.argv[2]);await mkdir(directory,{recursive:true});
const path=join(directory,'source-plan.json');
const plan=await readFile(path,'utf8').then(JSON.parse,()=>null) || newWeeklyPlan();
plan.weeks=plan.weeks.slice(0,1);plan.cutoff=plan.weeks[0].start;
plan.machines=['local-arm64','hub-amd64','remote-amd64'];plan.excludedEngines=[];
const exec=promisify(execFile);
async function github(path,paginate=false){const {stdout}=await exec('gh',['api',...(paginate?['--paginate','--jq','.[] | tojson']:[]),path],{timeout:120000,maxBuffer:32*1024*1024});return paginate?stdout.trim().split('\n').filter(Boolean).map(JSON.parse):JSON.parse(stdout)}
const upstream={releases:releaseInventory,defaultBranch:async repository=>(await github('repos/'+repository)).default_branch,commits:(repository,branch,until,count,since)=>github(`repos/${repository}/commits?sha=${encodeURIComponent(branch)}&until=${encodeURIComponent(until)}&per_page=${count}${since?'&since='+encodeURIComponent(since):''}`,!!since),releaseRevision:async(engine,spec,release)=>{const tag=spec.provider==='firefox'?'FIREFOX_'+release.tag_name.replaceAll('.','_')+'_RELEASE':release.tag_name;return(await github(`repos/${spec.repository}/commits/${encodeURIComponent(tag)}`)).sha}};
for(const engine of [...new Set([...historyEngineOrder,...Object.keys(engineSources)])]){
 if(plan.pins.some(p=>p.engine===engine&&p.status==='planned'))continue;
 plan.pins=plan.pins.filter(p=>p.engine!==engine);
 const spec=engineSources[engine];
 const pins=await planWeeklyEngine(engine,spec,plan,upstream);plan.pins.push(...pins);
 plan.engines=plan.engines.filter(p=>p.engine!==engine);plan.engines.push({engine,repository:spec.repository,planned:pins.filter(p=>p.status==='planned').length,gaps:pins.filter(p=>p.status!=='planned').length});
 await writeFile(path,JSON.stringify(plan,null,2)+'\n');
 console.log(JSON.stringify({engine,...pins[0]}));
}
