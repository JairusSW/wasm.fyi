import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {engineSources,releaseInventory} from './lib/engine-sources.mjs';
import {historyEngineOrder} from './lib/history-scope.mjs';
import {newWeeklyPlan,planWeeklyEngine} from './lib/weekly-source-plan.mjs';
const exec=promisify(execFile);
async function github(path,paginate=false){
 const args=['api',...(paginate?['--paginate','--jq','.[] | tojson']:[]),path];
 const {stdout}=await exec('gh',args,{maxBuffer:32*1024*1024,timeout:120000});
 return paginate?stdout.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)):JSON.parse(stdout);
}
const upstream={
 releases:releaseInventory,
 defaultBranch:async repository=>(await github('repos/'+repository)).default_branch,
 commits:(repository,branch,until,count,since)=>github(`repos/${repository}/commits?sha=${encodeURIComponent(branch)}&until=${encodeURIComponent(until)}&per_page=${count}${since?'&since='+encodeURIComponent(since):''}`,!!since),
 releaseRevision:async(engine,spec,release)=>{
  let tag=release.tag_name;
  if(spec.provider==='firefox')tag='FIREFOX_'+tag.replaceAll('.','_')+'_RELEASE';
  return (await github(`repos/${spec.repository}/commits/${encodeURIComponent(tag)}`)).sha;
 }
};
const root=resolve(process.argv[2]||join('.wasmfyi/local','six-month-campaign-'+new Date().toISOString().slice(0,10).replaceAll('-','')));
await mkdir(root,{recursive:true});
const plan=newWeeklyPlan(process.argv[3]||new Date().toISOString());
for(const engine of historyEngineOrder){
 const spec=engineSources[engine];
 try{plan.pins.push(...await planWeeklyEngine(engine,spec,plan,upstream));}
 catch(error){plan.pins.push(...plan.weeks.map(week=>({engine,repository:spec.repository,configurations:spec.configurations,targetWeek:week.end,weekStart:week.start,weekEnd:week.end,status:'unavailable',reason:String(error.message||error)})));}
 const rows=plan.pins.filter(p=>p.engine===engine);
 plan.engines.push({engine,repository:spec.repository,planned:rows.filter(p=>p.status==='planned').length,reused:rows.filter(p=>p.status==='reused').length,gaps:rows.filter(p=>p.status==='unavailable').length});
 await writeFile(join(root,'source-plan.json'),JSON.stringify(plan,null,2)+'\n');
 console.log(JSON.stringify(plan.engines.at(-1)));
}
