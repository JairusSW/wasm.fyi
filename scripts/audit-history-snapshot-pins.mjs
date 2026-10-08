import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {nearestCommit,nearestCommitSearchUntil} from './lib/history-scope.mjs';
import {monthsBefore} from './lib/weekly-history.mjs';
import {atomicJSON} from './lib/benchmark-plan.mjs';
const root=resolve(process.argv[2]),exec=promisify(execFile);
const plan=JSON.parse(await readFile(join(root,'source-plan.json')));
const sourceCutoff=monthsBefore(plan.anchor,12),audit={started:new Date().toISOString(),sourceCutoff,snapshotCutoff:plan.cutoff,checked:[],changes:[],errors:[]};
const branches=new Map();
async function api(path,paginate=false){
 const {stdout}=await exec('gh',['api',...(paginate?['--paginate']:[]),path,'--jq','tojson'],{maxBuffer:64*1024*1024});
 const pages=stdout.trim().split('\n').filter(Boolean).map(JSON.parse);return paginate?pages.flat():pages[0];
}
const pins=plan.pins.filter(pin=>pin.targetType==='main');
for(const repository of new Set(pins.map(pin=>pin.repository)))branches.set(repository,(await api('repos/'+repository)).default_branch);
for(let offset=0;offset<pins.length;offset+=4){
 await Promise.all(pins.slice(offset,offset+4).map(async pin=>{
  try{
   const branch=branches.get(pin.repository),base=`repos/${pin.repository}/commits?sha=${encodeURIComponent(branch)}`;
   const before=await api(base+'&until='+encodeURIComponent(pin.targetWeek)+'&per_page=1');
   const until=nearestCommitSearchUntil(before[0],pin.targetWeek,{cutoff:sourceCutoff,anchor:plan.anchor});
   const after=Date.parse(until)>Date.parse(pin.targetWeek)?await api(base+'&since='+encodeURIComponent(pin.targetWeek)+'&until='+encodeURIComponent(until)+'&per_page=100',true):[];
   const commit=nearestCommit([...before,...after],pin.targetWeek,{cutoff:sourceCutoff,anchor:plan.anchor});
   const entry={engine:pin.engine,targetWeek:pin.targetWeek,previousStatus:pin.status,previousRevision:pin.revision||null,branch,prior:before[0]?.sha||null,candidateCount:before.length+after.length,selectedRevision:commit?.sha||null,committedAt:commit?.commit?.committer?.date||commit?.commit?.author?.date||null};
   audit.checked.push(entry);
   if(commit&&(pin.status!=='planned'||pin.revision!==commit.sha))audit.changes.push({...entry,pin:{...pin,branch,revision:commit.sha,committedAt:entry.committedAt,url:commit.html_url,status:'planned',reason:undefined}});
   if(!commit&&pin.status==='planned')audit.errors.push({...entry,error:'Previously planned source has no eligible nearest commit'});
  }catch(error){audit.errors.push({engine:pin.engine,targetWeek:pin.targetWeek,error:String(error)});}
 }));
 await atomicJSON(join(root,'snapshot-pin-audit.json'),audit);
 console.log(JSON.stringify({checked:audit.checked.length,total:pins.length,changes:audit.changes.length,errors:audit.errors.length}));
}
audit.completed=new Date().toISOString();audit.status=audit.errors.length?'needs-repair':'audited';
await atomicJSON(join(root,'snapshot-pin-audit.json'),audit);
// Leave the live plan unchanged until the complete audit is reviewed.
