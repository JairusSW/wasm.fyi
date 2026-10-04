import {mkdir,readFile,writeFile,rm,appendFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {parseCorpusJSON} from './corpus.mjs';
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

export async function collectCorpusByCorpus({directory,suite,runtimes,collection,run,number,site}) {
  const workloads=parseCorpusJSON(await readFile(suite,'utf8'));
  const groups=corpusGroups(workloads),reports=[];
  const state=await readFile(join(directory,'collection.json'),'utf8').then(JSON.parse,error=>{if(error.code!=='ENOENT')throw error;return {schema:1,order:'corpus-by-corpus',started:new Date().toISOString(),workloads:workloads.length,corpora:groups.length,completed:[]};});
  if(state.workloads!==workloads.length||state.corpora!==groups.length)throw Error('Resume corpus differs from the saved collection');
  const log=join(directory,'progress.jsonl');
  const invoke=(...args)=>{const output=run(...args);process.stdout.write(output);return output;};
  const pass=(...args)=>{
    try{invoke(...args);}catch(error){
      if(process.env.WASMBENCH_RECORD_FAILURES!=='1')throw error;
      invoke('verify','--run',args[args.indexOf('--out')+1]);
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
    const timing=join(scratch,prefix+'-timing'),memory=join(scratch,prefix+'-memory'),code=join(scratch,prefix+'-code');
    const timingRSS=collection.memory&&collection.timingPeakRSS!==false&&process.env.WASMBENCH_TIMING_ONLY!=='1';
    const samples=process.env.WASMBENCH_SCENARIO_SAMPLES?JSON.parse(process.env.WASMBENCH_SCENARIO_SAMPLES):collection.scenarioSamples||{'*':1};
    pass('run',...shared,'--scenarios','compile,instantiate,first-call,steady',...(timingRSS?['--timing-peak-rss']:[]),'--profile','timing','--launches',String(number('WASMBENCH_LAUNCHES',collection.launches)),'--samples',String(number('WASMBENCH_SAMPLES',collection.samples)),'--samples-by-scenario',JSON.stringify(samples),'--operations',String(number('WASMBENCH_OPERATIONS',collection.operations)),'--warmup',String(number('WASMBENCH_WARMUP',collection.warmup,0)),'--out',timing);
    invoke('verify','--run',timing);
    const report=join(scratch,'report'),args=['report','--run',timing,'--out',report];
    if(collection.memory&&process.env.WASMBENCH_TIMING_ONLY!=='1') {
      pass('run',...shared,'--scenarios','compile,instantiate,first-call,steady','--profile','memory','--launches','1','--samples','1','--operations','1','--warmup','0',...(collection.phaseBarriers?['--phase-barriers']:[]),'--out',memory);
      invoke('verify','--run',memory);args.push('--memory-run',memory);
    }
    if(collection.code&&process.env.WASMBENCH_TIMING_ONLY!=='1') {
      pass('run',...shared,'--scenarios','compile','--profile','code','--launches','1','--samples','1','--operations','1','--warmup','0','--out',code);
      invoke('verify','--run',code);args.push('--code-run',code);
    }
    invoke(...args);invoke('verify-report','--dir',report);
    if(process.env.WASMBENCH_WAGO_REVISION) {
      const data=JSON.parse(await readFile(join(report,'data.json')));
      if(!data.bundle.manifest.lock.runtime_configurations.find(r=>r.id==='wago')?.description.runtime_version.startsWith(process.env.WASMBENCH_WAGO_REVISION+'/'))throw Error('Measured Wago adapter differs from the pinned revision');
    }
    const exported=await exportWasmFyiReport(report,join(directory,'exports'));
    const path=resolve(directory,'exports',exported.path);
    const extraReports=[],extraBundles=[];
    if(runtimes==='wago'&&group.every(w=>w.id.startsWith('mechanisms/'))) {
      const callTiming=join(scratch,prefix+'-call-timing'),callReport=join(scratch,id+'-call-latency','report');
      await mkdir(join(scratch,id+'-call-latency'));
      pass('run',...shared,'--scenarios','steady','--profile','timing','--launches',String(number('WASMBENCH_LAUNCHES',collection.launches)),'--samples','5','--operations','1000000','--warmup','3','--out',callTiming);
      invoke('verify','--run',callTiming);invoke('report','--run',callTiming,'--out',callReport);invoke('verify-report','--dir',callReport);
      const callData=JSON.parse(await readFile(join(callReport,'data.json'))),mainData=JSON.parse(await readFile(join(report,'data.json')));
      if(callData.bundle.manifest.lock.runtime_configurations[0].description.runtime_version!==mainData.bundle.manifest.lock.runtime_configurations[0].description.runtime_version)throw Error('Call adapter changed within corpus collection');
      const callExport=await exportWasmFyiReport(callReport,join(directory,'exports'));
      extraReports.push(resolve(directory,'exports',callExport.path));extraBundles.push(['calls',callTiming]);
    }
    reports.push(path,...extraReports);
    // Keep raw trial logs and the verified data, but discard duplicate tools,
    // Wasm copies and report rendering files before collecting the next corpus.
    const evidence=join(directory,'logs',id);await mkdir(evidence,{recursive:true});
    for(const [name,bundle] of [['timing',timing],...extraBundles,...(collection.memory&&process.env.WASMBENCH_TIMING_ONLY!=='1'?[['memory',memory]]:[]),...(collection.code&&process.env.WASMBENCH_TIMING_ONLY!=='1'?[['code',code]]:[])]) {
      const {readdir,copyFile}=await import('node:fs/promises');
      const target=join(evidence,name);await mkdir(join(target,'trials'),{recursive:true});
      for(const file of ['manifest.json','checksums.json'])await copyFile(join(bundle,file),join(target,file));
      for(const file of await readdir(join(bundle,'trials')))await copyFile(join(bundle,'trials',file),join(target,'trials',file));
    }
    const completed={corpus:id,workloads:group.map(w=>w.id),report:path,reports:[path,...extraReports],...exported,finished:new Date().toISOString()};
    state.completed.push(completed);await appendFile(log,JSON.stringify(completed)+'\n');
    await writeFile(join(directory,'collection.json'),JSON.stringify(state,null,2)+'\n');
    await rm(scratch,{recursive:true,force:true});
  }
  await writeFile(join(site,'.wasmbench/latest-reports.json'),JSON.stringify(reports)+'\n');
  await writeFile(join(site,'.wasmbench/latest-report.txt'),reports.at(-1)+'\n');
  state.finished=new Date().toISOString();await writeFile(join(directory,'collection.json'),JSON.stringify(state,null,2)+'\n');
  return reports;
}
