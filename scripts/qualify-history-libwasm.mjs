import {readFile,mkdir,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {atomicJSON} from './lib/benchmark-plan.mjs';
import {command} from './lib/wasmbench.mjs';

const root=resolve(process.argv[2]);
const template=JSON.parse(await readFile(join(root,'collection-template.json')));
const plan=JSON.parse(await readFile(join(root,'source-plan.json')));
const pin=plan.pins.filter(p=>p.engine==='libwasm'&&p.status==='planned').sort((a,b)=>Date.parse(b.targetWeek)-Date.parse(a.targetWeek))[0];
if(!pin?.revision||template.collection.samples<12)throw Error('A pinned source and at least twelve samples are required');
const build=join(root,'libwasm-builds',pin.revision.slice(0,12));
const receipt=JSON.parse(await readFile(join(build,'qualification-build.json')));
if(receipt.revision!==pin.revision)throw Error('Libwasm build receipt differs from planned source');
const directory=join(build,'capture-qualification'),output=join(root,'qualification-captures');
const ids=['wago/tiny/add','wago/memory/sum','mechanisms/wasm-to-host-call'];
const workloads=template.workloads.filter(w=>ids.includes(w.id));
if(workloads.length!==ids.length)throw Error('Qualification corpus is incomplete');
const controller=receipt.controller||join(build,'controller');
if(!receipt.controller)command('go',['build','-trimpath','-o',controller,'./cmd/wasmbench'],{cwd:join(root,'frozen-harness'),env:{...process.env,...template.env,GOWORK:'off',GOFLAGS:'-buildvcs=false',GOMAXPROCS:'1'},stdio:'inherit'});
const job={id:'qualify-libwasm-'+pin.revision.slice(0,12),engine:'libwasm',harness:receipt.harness,controller,forceCapture:true,historical:true,source:{repository:pin.repository,revision:pin.revision,ref:'main@'+pin.revision.slice(0,8),asOf:pin.targetWeek,kind:'snapshot'}};
await mkdir(directory,{recursive:true});
await atomicJSON(join(directory,'plan.json'),{...template,captureDirectory:output,workloads,jobs:[job]});
command(process.execPath,[join(process.cwd(),'scripts/benchmark-history-worker.mjs'),directory],{env:{...process.env,...template.env},stdio:'inherit',timeout:48*60*60*1000});
const status=JSON.parse(await readFile(join(directory,'status.json')));
if(status.status!=='completed'||status.completed!==ids.length)throw Error('Incomplete Libwasm qualification');
const captures=[];
for(const file of (await readdir(output)).filter(f=>f.startsWith(job.id+'-')&&f.endsWith('.json'))){
 const capture=JSON.parse(await readFile(join(output,file)));
 if(capture.source?.revision!==pin.revision||capture.results.length!==4)throw Error('Incorrect source or missing phases');
 for(const phase of ['compile','instantiate','first-call','steady']){
  const row=capture.results.find(r=>r.phase===phase);
  if(!row||row.latencyStatus!=='ok'||row.timingSamples<12||!Number.isFinite(row.latencyNs)||row.latencyNs<0||row.memoryStatus!=='ok'||row.peakRssBytes<=0||row.codeStatus!=='unsupported'||row.codeBytes!==null)throw Error('Libwasm qualification failed for '+file+' '+phase);
 }
 captures.push(file);
}
if(captures.length!==ids.length)throw Error('Missing qualification captures');
await atomicJSON(join(directory,'qualification.json'),{revision:pin.revision,verifiedAt:new Date().toISOString(),captures,phases:['compile','instantiate','first-call','steady'],minimumSamples:12,nativeCode:'not available: interpreter',scope:'Three adapter probes; full corpus coverage and physical CPU affinity require separate audits'});
