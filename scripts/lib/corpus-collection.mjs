import {mkdir,readFile,writeFile,rm,appendFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {collectCallBatches,callBatchOperations} from './call-timing.mjs';
import {parseCorpusJSON} from './corpus.mjs';
import {atomicJSON} from './benchmark-plan.mjs';
import {exportWasmFyiReport} from './wasmfyi-export.mjs';

// Keep every contract for the same Wasm artifact together, including its variants.
export function corpusGroups(workloads) {
  const groups=new Map();
  for(const workload of workloads) {
    const key=workload.sha256;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(workload);
  }
  return [...groups.values()];
}

export function selectedScenarioSamples(collection, overrides) {
  const requested=overrides ? JSON.parse(overrides) : collection.scenarioSamples || {'*':1};
  const selected=(collection.scenarios || 'compile,instantiate,first-call,steady').split(',');
  return Object.fromEntries(Object.entries(requested).filter(([scenario])=>scenario==='*' || selected.includes(scenario)));
}

export async function collectCorpusByCorpus({directory,suite,runtimes,collection,run,number,site,onBundle}) {
  const workloads=parseCorpusJSON(await readFile(suite,'utf8'));
  const groups=corpusGroups(workloads),reports=[];
  const state=await readFile(join(directory,'collection.json'),'utf8').then(JSON.parse,error=>{if(error.code!=='ENOENT')throw error;return {schema:1,order:'corpus-by-corpus',started:new Date().toISOString(),workloads:workloads.length,corpora:groups.length,completed:[]};});
  if(state.workloads!==workloads.length||state.corpora!==groups.length)throw Error('Resume corpus differs from the saved collection');
  const log=join(directory,'progress.jsonl');
  const invoke=async(...args)=>{const output=await run(...args);process.stdout.write(output);return output;};
  const pass=async(...args)=>{
    try{await invoke(...args);}catch(error){
      if(process.env.WASMBENCH_RECORD_FAILURES!=='1')throw error;
      await invoke('verify','--run',args[args.indexOf('--out')+1]);
    }
  };
  for(const [index,group] of groups.entries()) {
    if(state.completed[index]) {
      const saved=state.completed[index];
      if(JSON.stringify(saved.workloads)!==JSON.stringify(group.map(w=>w.id)))throw Error('Resume workload order changed');
      const data=JSON.parse(await readFile(join(saved.report,'data.json')));
      if(process.env.WASMBENCH_WAGO_REVISION&&!data.bundle.manifest.lock.runtime_configurations.find(r=>r.id==='wago')?.description.runtime_version.startsWith(process.env.WASMBENCH_WAGO_REVISION+'/'))throw Error('Resume Wago revision differs from saved evidence');
      reports.push(...(saved.reports||[saved.report]));continue;
    }
    const id='corpus-'+String(index+1).padStart(4,'0');
    const scratch=join(directory,id),manifest=join(scratch,'suite.json');
    await mkdir(scratch,{recursive:true});
    await writeFile(manifest,JSON.stringify(group)+'\n');
    console.log(`[${index+1}/${groups.length}] ${group.map(w=>w.id).join(', ')}: compile → instantiate → execute → log → cleanup`);
    const shared=['--archive-tools=true','--suite',manifest,'--runtimes',runtimes,'--workers','1','--timeout',collection.timeout,'--validation-profile',process.env.WASMBENCH_VALIDATION_PROFILE||collection.validationProfile||'all'];
    const prefix=directory.split('/').at(-1)+'-'+id+'-'+Date.now();
    let timing=join(scratch,prefix+'-timing');
    const memory=join(scratch,prefix+'-memory'),code=join(scratch,prefix+'-code');
    const timingRSS=collection.memory&&collection.timingPeakRSS!==false&&process.env.WASMBENCH_TIMING_ONLY!=='1';
    const samples=selectedScenarioSamples(collection,process.env.WASMBENCH_SCENARIO_SAMPLES);
    if(collection.callsOnly && group.every(w=>w.id.startsWith('mechanisms/'))) {
      timing=await collectCallBatches({directory:scratch,prefix,evidenceDirectory:join(directory,'logs',id,'calibration'),samples:number('WASMBENCH_CALL_SAMPLES',collection.samples),operations:callBatchOperations(group[0]),run:async(out,operations,samples)=>pass('run',...shared,'--scenarios','steady','--profile','timing','--launches',String(number('WASMBENCH_LAUNCHES',collection.launches)),'--samples',String(samples),'--operations',String(operations),'--warmup','3','--out',out),verify:async(out)=>invoke('verify','--run',out),load:async(out)=>{const {readdir}=await import('node:fs/promises');return Promise.all((await readdir(join(out,'trials'))).filter(n=>n.endsWith('.json')).map(async(n)=>JSON.parse(await readFile(join(out,'trials',n)))));},onAttempt:async(attempt)=>appendFile(join(directory,'call-calibration.jsonl'),JSON.stringify(attempt)+'\n')});
    } else {
    await pass('run',...shared,'--scenarios',collection.scenarios || 'compile,instantiate,first-call,steady',...(timingRSS?['--timing-peak-rss']:[]),'--profile','timing','--launches',String(number('WASMBENCH_LAUNCHES',collection.launches)),'--samples',String(number('WASMBENCH_SAMPLES',collection.samples)),'--samples-by-scenario',JSON.stringify(samples),'--operations',String(number('WASMBENCH_OPERATIONS',collection.operations)),'--warmup',String(number('WASMBENCH_WARMUP',collection.warmup,0)),'--out',timing);
    }
    await invoke('verify','--run',timing);
    const report=join(scratch,'report'),args=['report','--run',timing,'--out',report];
    if(collection.memory&&process.env.WASMBENCH_TIMING_ONLY!=='1') {
      await pass('run',...shared,'--scenarios',collection.scenarios || 'compile,instantiate,first-call,steady','--profile','memory','--launches','1','--samples','1','--operations','1','--warmup','0',...(collection.phaseBarriers?['--phase-barriers']:[]),'--out',memory);
      await invoke('verify','--run',memory);args.push('--memory-run',memory);
    }
    if(collection.code&&process.env.WASMBENCH_TIMING_ONLY!=='1') {
      await pass('run',...shared,'--scenarios','compile','--profile','code','--launches','1','--samples','1','--operations','1','--warmup','0','--out',code);
      await invoke('verify','--run',code);args.push('--code-run',code);
    }
    await invoke(...args);await invoke('verify-report','--dir',report);
    if(process.env.WASMBENCH_WAGO_REVISION) {
      const data=JSON.parse(await readFile(join(report,'data.json')));
      if(!data.bundle.manifest.lock.runtime_configurations.find(r=>r.id==='wago')?.description.runtime_version.startsWith(process.env.WASMBENCH_WAGO_REVISION+'/'))throw Error('Measured Wago adapter differs from the pinned revision');
    }
    const exported=await exportWasmFyiReport(report,join(directory,'exports'));
    const path=resolve(directory,'exports',exported.path);
    if(collection.siteExportV2)await invoke('export-site','--report',report,'--out',join(dirname(path),'site-v2'));
    const extraReports=[],extraBundles=[];
    if(!collection.callsOnly && (!collection.scenarios || collection.scenarios.split(',').includes('steady')) && group.every(w=>w.id.startsWith('mechanisms/'))) {
      const callReport=join(scratch,id+'-call-latency','report');
      const callTiming=await collectCallBatches({directory:scratch,prefix,evidenceDirectory:join(directory,'logs',id,'calibration'),samples:number('WASMBENCH_CALL_SAMPLES',3),operations:callBatchOperations(group[0]),run:async(out,operations,samples)=>pass('run',...shared,'--scenarios','steady','--profile','timing','--launches',String(number('WASMBENCH_LAUNCHES',collection.launches)),'--samples',String(samples),'--operations',String(operations),'--warmup','3','--out',out),verify:async(out)=>invoke('verify','--run',out),load:async(out)=>{const {readdir}=await import('node:fs/promises');return Promise.all((await readdir(join(out,'trials'))).filter(n=>n.endsWith('.json')).map(async(n)=>JSON.parse(await readFile(join(out,'trials',n)))));},onAttempt:async(attempt)=>appendFile(join(directory,'call-calibration.jsonl'),JSON.stringify(attempt)+'\n')});
      await mkdir(join(scratch,id+'-call-latency'));

      await invoke('verify','--run',callTiming);await invoke('report','--run',callTiming,'--out',callReport);await invoke('verify-report','--dir',callReport);
      const callData=JSON.parse(await readFile(join(callReport,'data.json'))),mainData=JSON.parse(await readFile(join(report,'data.json')));
      if(JSON.stringify(callData.bundle.manifest.lock.runtime_configurations)!==JSON.stringify(mainData.bundle.manifest.lock.runtime_configurations))throw Error('Call adapters changed within corpus collection');
      const callExport=await exportWasmFyiReport(callReport,join(directory,'exports'));
      if(collection.siteExportV2)await invoke('export-site','--report',callReport,'--out',join(dirname(resolve(directory,'exports',callExport.path)),'site-v2'));
      extraReports.push(resolve(directory,'exports',callExport.path));extraBundles.push(['calls',callTiming]);
    }
    reports.push(path,...extraReports);
    // Keep raw trial logs and the verified data, but discard duplicate tools,
    // Wasm copies and report rendering files before collecting the next corpus.
    const evidence=join(directory,'logs',id);await mkdir(evidence,{recursive:true});
    for(const [name,bundle] of [['timing',timing],...extraBundles,...(collection.memory&&process.env.WASMBENCH_TIMING_ONLY!=='1'?[['memory',memory]]:[]),...(collection.code&&process.env.WASMBENCH_TIMING_ONLY!=='1'?[['code',code]]:[])]) {
      await onBundle?.({bundle,profile:name,corpus:id});
      const {readdir,copyFile,cp}=await import('node:fs/promises');
      const target=join(evidence,name);await mkdir(join(target,'trials'),{recursive:true});
      for(const file of ['manifest.json','checksums.json'])await copyFile(join(bundle,file),join(target,file));
      for(const file of await readdir(join(bundle,'trials')))await copyFile(join(bundle,'trials',file),join(target,'trials',file));
      await cp(join(bundle,'logs'),join(target,'logs'),{recursive:true}).catch(error=>{if(error.code!=='ENOENT')throw error;});
    }
    const completed={corpus:id,workloads:group.map(w=>w.id),report:path,reports:[path,...extraReports],...exported,finished:new Date().toISOString()};
    state.completed.push(completed);await appendFile(log,JSON.stringify(completed)+'\n');
    await atomicJSON(join(directory,'collection.json'),state);
    await rm(scratch,{recursive:true,force:true});
  }
  await writeFile(join(site,'.wasmbench/latest-reports.json'),JSON.stringify(reports)+'\n');
  await writeFile(join(site,'.wasmbench/latest-report.txt'),reports.at(-1)+'\n');
  state.finished=new Date().toISOString();await atomicJSON(join(directory,'collection.json'),state);
  return reports;
}
