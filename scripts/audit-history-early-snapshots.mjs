// Recheck snapshots predating a repository's first commit without an arbitrary
// one-week search limit. Query each complete eligible branch interval once.
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {nearestCommit} from './lib/history-scope.mjs';
import {monthsBefore} from './lib/weekly-history.mjs';
import {atomicJSON} from './lib/benchmark-plan.mjs';
const root=resolve(process.argv[2]),exec=promisify(execFile);
const plan=JSON.parse(await readFile(join(root,'source-plan.json'))),previous=JSON.parse(await readFile(join(root,'snapshot-pin-audit.json')));
const audited=new Set(previous.checked.filter(p=>p.prior===null||p.previousStatus!=='planned').map(p=>p.engine+'|'+p.targetWeek));
const pins=plan.pins.filter(p=>p.targetType==='main'&&audited.has(p.engine+'|'+p.targetWeek));
const sourceCutoff=monthsBefore(plan.anchor,12),audit={started:new Date().toISOString(),sourceCutoff,checked:[],changes:[],errors:[]};
async function api(path,paginate=false){const {stdout}=await exec('gh',['api',...(paginate?['--paginate']:[]),path,'--jq','tojson'],{maxBuffer:64*1024*1024});const pages=stdout.trim().split('\n').filter(Boolean).map(JSON.parse);return paginate?pages.flat():pages[0];}
for(const repository of new Set(pins.map(p=>p.repository))){
 try{
  const branch=(await api('repos/'+repository)).default_branch;
  const candidates=await api(`repos/${repository}/commits?sha=${encodeURIComponent(branch)}&since=${encodeURIComponent(sourceCutoff)}&until=${encodeURIComponent(plan.anchor)}&per_page=100`,true);
  for(const pin of pins.filter(p=>p.repository===repository)){
   const commit=nearestCommit(candidates,pin.targetWeek,{cutoff:sourceCutoff,anchor:plan.anchor});
   const entry={engine:pin.engine,targetWeek:pin.targetWeek,previousStatus:pin.status,previousRevision:pin.revision||null,candidateCount:candidates.length,selectedRevision:commit?.sha||null,committedAt:commit?.commit?.committer?.date||null};audit.checked.push(entry);
   if(commit&&(pin.status!=='planned'||pin.revision!==commit.sha))audit.changes.push({...entry,pin:{...pin,branch,revision:commit.sha,committedAt:entry.committedAt,url:commit.html_url,status:'planned',reason:undefined}});
  }
 }catch(error){audit.errors.push({repository,error:String(error)});}
 await atomicJSON(join(root,'early-snapshot-pin-audit.json'),audit);
 console.log(JSON.stringify({checked:audit.checked.length,changes:audit.changes.length,errors:audit.errors.length}));
}
audit.completed=new Date().toISOString();await atomicJSON(join(root,'early-snapshot-pin-audit.json'),audit);
