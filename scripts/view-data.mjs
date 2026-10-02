import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { featureCandidates, featureSupport, featureCasePassed } from './lib/feature-support.mjs';
import { validateV8Description } from './lib/v8-preflight.mjs';
import { digest, site, config } from './lib/wasmbench.mjs';
import { validateData } from './lib/validate-data.mjs';
import { workloadCategory, compareWorkloads } from './lib/workload-category.mjs';
import { measuredTiming, measuredMemory, measuredCodeImage, measuredHistory } from '../src/lib/measured.ts';

// This is the view projection of verified evidence, never a source of measurements.
const root = join(site, 'data/wasmbench');
await validateData(root);
const index = JSON.parse(await readFile(join(root,'index.json')));
const reports = [];
for (const entry of index.reports) {
  const bytes = await readFile(join(root, entry.projection));
  if (digest(bytes) !== entry.projectionSha256) throw new Error('Changed view input');
  reports.push(JSON.parse(bytes));
}
reports.sort((a,b)=>b.created.localeCompare(a.created));
const settings=await config();
for(const report of reports)for(const runtime of report.runtimes) {
  const modes={'v8-optimizing-only':'optimizing-only','v8-liftoff-only':'liftoff-only'};
  if(modes[runtime.id])validateV8Description(runtime.description,settings.node,modes[runtime.id],{allowLegacyCache:true});
}
for(const os of ['linux','darwin']) {
  const experimental=reports.find(r=>r.host.os===os && r.runtimes.some(c=>c.id==='v8-wasmfx'))?.runtimes.find(c=>c.id==='v8-wasmfx');
  if(experimental)validateV8Description(experimental.description,settings.node,'optimizing-wasmfx-only',{allowLegacyCache:true});
}
const configurations = { A:'wasmtime', B:'wasmtime-winch', C:'wasmer-llvm', D:'wasmer-singlepass', E:'wazero', F:'v8-optimizing-only', G:'wago', H:'v8-liftoff-only', I:'wasmi', J:'wasmedge', K:'wasm3', L:'wavm', M:'spidermonkey', N:'jsc', O:'deno', P:'wamr', Q:'chicory', R:'wasmtime-component-async', S:'v8-wasmfx' };
const scenarios = { compile:'compile', inst:'instantiate', first:'first-call', steady:'steady' };
const memoryScenarios={rss:'steady',rssCompile:'compile',rssInst:'instantiate',rssFirst:'first-call'};
const prepared=JSON.parse(await readFile(join(site,'corpora/catalog.json')));
if(prepared.schema!==1)throw Error('Unknown prepared corpus schema');
const preparedById=new Map(prepared.workloads.map(w=>[w.contractId,w]));
const catalogue = new Map();
for (const report of reports) for (const w of report.workloads) {
  if (!/^(wago|features|applications)\//.test(w.id) || catalogue.has(w.id) || (!w.id.startsWith('features/') && preparedById.get(w.id)?.sha256!==w.sha256)) continue;
  const structure = report.artifactStructures?.find(a=>a.sha256===w.sha256);
  if(!structure || !Number.isSafeInteger(structure.bytes) || structure.bytes < 8)throw new Error('Missing measured artifact size: '+w.id);
  const baselineReport=reports.find(r=>r.runtimes.some(c=>c.id==='wasmtime') && r.workloads.some(item=>item.id===w.id && item.sha256===w.sha256));
  const baseline=baselineReport?measuredTiming(baselineReport,'wasmtime',w.id,w.sha256,'steady'):null;
  catalogue.set(w.id, {
    id:w.id, artifactSha256:w.sha256, evidenceScope:w.provenance?.scope, baseline:!!w.provenance?.baseline, tags:[...(w.features || []),...(w.original_contract?.tags || [])],
    kb:structure.bytes/1024, ms:baseline?.status==='ok'?baseline.value/1e6:null,
    group:preparedById.get(w.id)?.category || workloadCategory(w),
    purpose:w.original_contract?.desc || w.provenance?.description || `${w.provenance?.scope || w.abi} · ${w.work_unit} · ${w.units_per_invocation} units/invocation`,
    input:JSON.stringify(w.args || w.vectors || []), src:w.source || w.generator,
    unitsPerInvocation:w.units_per_invocation, workUnit:w.work_unit, abi:w.abi, reset:w.reset, oracle:w.oracle, imports:structure.imports
  });
}
// Prepared inventory adds discoverable workloads only; no measurement cells or
// evidence report IDs are synthesized for these entries.
for(const w of prepared.workloads) {
  if(catalogue.has(w.contractId))continue;
  if(!/^[a-f0-9]{64}$/.test(w.sha256)||!Number.isSafeInteger(w.artifactBytes)||w.artifactBytes<8)throw Error('Invalid prepared artifact '+w.contractId);
  catalogue.set(w.contractId,{
    id:w.contractId,artifactSha256:w.sha256,evidenceScope:'execution',baseline:false,tags:[],kb:w.artifactBytes/1024,ms:null,
    group:w.category,purpose:`${w.description} · ${w.status==='adapter-needed'?'adapter needed: '+w.reason:'prepared corpus; awaiting measurements'}`,
    input:JSON.stringify(w.args||[]),src:typeof w.source==='string'?w.source:w.source?.repository||w.source?.source||'corpora/catalog.json',
    unitsPerInvocation:w.unitsPerInvocation,workUnit:w.workUnit,abi:w.abi,reset:w.reset,oracle:w.oracle
  });
}
const reasons=new Map();
function reasonId(reason) { if(!reasons.has(reason)){reasons.set(reason,reasons.size);output.reasons.push(reason);}return reasons.get(reason); }
const status = { ok:'ok', unsupported:'unsupported', failed:'failed', 'not-measured':'nm', 'not-collected':'nm' };
const output = { schema:1, configurations, applicationConfigurations:Object.keys(configurations).filter(slot=>settings.collection.runtimes.includes(configurations[slot])), catalogue:[...catalogue.values()].sort(compareWorkloads), hosts:{}, reports:{}, reasons:[],history:{},threads:{},statistics:{timingSamples:reports.reduce((n,r)=>n+r.summaries.reduce((n,s)=>n+(s.recorded_samples || 0),0),0)} };
for (const report of reports) output.reports[report.id] = { runId:report.runId, created:report.created, evidence:report.evidence, sha256:report.evidenceSha256, options:report.options,memorySource:report.memorySource,codeSource:report.codeSource,configurations:report.runtimes.map(c=>c.id),host:report.host.os };
for (const [machine, os] of [['m1','linux'],['m2','darwin']]) {
  const selected = reports.filter(r=>r.host.os===os);
  if (!selected.length) throw new Error('Missing measured host: '+os);
  const host = selected[0].host;
  // These selector slots retain their URL encoding; their facts are measured.
  const view = { label:`${host.cpu_description} · ${host.hostname}`, os:`${host.os}/${host.arch} · ${host.kernel}`, policy:host.policy, configurations:{}, snapshots:{s1:{},s2:{}} };
  output.hosts[machine]=view;
  for (const [slot,runtime] of Object.entries(configurations)) {
    const config=selected.flatMap(r=>r.runtimes).find(c=>c.id===runtime);
    if (config) view.configurations[slot]={ runtime, version:runtime==='deno' && config.description.build?.startsWith('Deno ')?`${config.description.build.slice(5)} / V8 ${config.description.runtime_version}`:config.description.runtime_version, backend:config.description.backend };
    for (const workload of output.catalogue) {
      // A newer failed/unsupported result wins. Never backfill it with a success.
      const cohort=workload.id.startsWith('features/')?featureCandidates(selected,runtime,workload.id,workload.artifactSha256):selected.filter(r=>r.runtimes.some(c=>c.id===runtime) && r.workloads.some(w=>w.id===workload.id && w.sha256===workload.artifactSha256));
      for (const metric of [...Object.keys(scenarios),...Object.keys(memoryScenarios),'code']) {
        // Partial sealed passes advance only metrics they actually measured.
        // A timing-only snapshot must not erase the last measured RSS or code image.
        const candidates=cohort.filter(report=>memoryScenarios[metric]
          ? report.memory.some(m=>m.runtime===runtime && m.workload===workload.id && m.scenario===memoryScenarios[metric] && m.metric==='process.peak_rss')
          : metric==='code'
            ? report.codeRecords.some(c=>c.runtime===runtime && c.workload===workload.id)
            : report.summaries.some(s=>s.runtime===runtime && s.workload===workload.id && s.scenario===scenarios[metric] && s.profile==='timing'));
        for (const [i,snapshot] of ['s1','s2'].entries()) {
          const report=candidates[i];
          if (!report) continue;
          const cell=memoryScenarios[metric]?measuredMemory(report,runtime,workload.id,workload.artifactSha256,memoryScenarios[metric],'process.peak_rss'):
            metric==='code'?measuredCodeImage(report,runtime,workload.id,workload.artifactSha256):
            measuredTiming(report,runtime,workload.id,workload.artifactSha256,scenarios[metric]);
          const factor=memoryScenarios[metric]?1024**2:metric==='code'?1024:1e6;
          const summary=report.summaries.find(s=>s.runtime===runtime && s.workload===workload.id && s.scenario===(scenarios[metric] || 'steady') && s.profile==='timing');
          const memory=memoryScenarios[metric]?report.memory.find(m=>m.runtime===runtime && m.workload===workload.id && m.scenario===memoryScenarios[metric] && m.metric==='process.peak_rss'):null;
          const launchMedians=memoryScenarios[metric]?(memory?.launch_values || []).map(v=>v.bytes/factor):metric==='code'?[]:Object.values(summary?.launch_medians || {}).map(v=>v/factor);
          view.snapshots[snapshot][`${workload.id}|${slot}|${metric}`]={st:status[cell.status], ...(cell.status==='ok'?{v:cell.value/factor, ...(cell.interval?{interval:cell.interval.map(v=>v/factor)}:{})}:{reason:reasonId(cell.reason)}),report:report.id,
            launchMedians};
        }
      }
    }
  }
}
// Compact feature version evidence; no trial arrays enter the browser bundle.
const support=await featureSupport(root,reports);
output.featureVersions=Object.fromEntries(['m1','m2'].map(machine=>{
  const os=machine==='m1'?'linux':'darwin';
  const host=support.hosts.find(h=>h.host.os===os && h.host.hostname===reports.find(r=>r.host.os===os).host.hostname);
  return [machine,(host?.versions || []).map(({features,...version})=>({...version,
    description:{runtime:version.description.runtime,runtime_version:version.description.runtime_version,backend:version.description.backend},
    features:features.map(({cases,...feature})=>{
      const current=cases.filter(c=>catalogue.get(c.workload)?.artifactSha256===c.artifactSha256);
      return {...feature,total:current.length,pass:current.filter(featureCasePassed).length,
        executed:current.filter(c=>c.status==='executed').length,compiledOnly:current.filter(c=>c.status==='compile-only').length,
        failed:current.filter(c=>c.status==='failed').length,unsupported:current.filter(c=>c.status==='unsupported').length,
        contracts:current.map(c=>({workload:c.workload,status:featureCasePassed(c)?'passed':c.status==='failed'?'failed':'unsupported',scope:c.scope,report:c.report,reasons:c.reasons})),
        reports:[...new Set(current.map(c=>c.report))],reasons:[...new Set(current.flatMap(c=>c.reasons))]};
    })}))];
}));
for(const [machine,name] of [['m1','history-hub'],['m2','history']]) {
  const directory=join(site,'data',name);
  await validateData(directory);
  const inventory=JSON.parse(await readFile(join(directory,'index.json')));
  const weekly=JSON.parse(await readFile(join(directory,'weekly.json')));
  const snapshots=[];
  for(const entry of inventory.reports){
    const bytes=await readFile(join(directory,entry.projection));
    if(digest(bytes)!==entry.projectionSha256)throw new Error('Changed history input');
    const report=JSON.parse(bytes);snapshots.push(report);
    if(!output.reports[report.id])output.reports[report.id]={runId:report.runId,created:report.created,evidence:name+'/'+report.evidence,sha256:report.evidenceSha256,options:report.options,memorySource:report.memorySource,codeSource:report.codeSource,configurations:report.runtimes.map(c=>c.id),host:report.host.os,historical:true};
  }
  const baseline=snapshots.find(s=>s.id===weekly.baseline.report);
  if(!baseline)throw new Error('Missing fixed history baseline');
  const history={points:weekly.results.map(w=>({date:w.targetWeek.slice(0,10),revision:w.revision,collectedAt:w.collectedAt,status:w.status})),workloads:baseline.workloads.filter(w=>catalogue.has(w.id)).map(w=>w.id),cells:{},versions:{}};
  output.history[machine]=history;
  for(const [slot,runtime] of Object.entries(configurations)) {
    const description=baseline.runtimes.find(c=>c.id===runtime)?.description;
    history.versions[slot]=weekly.results.map(w=>slot==='G'?w.revision:description?.runtime_version || 'not collected');
    for(const w of baseline.workloads) {
      const canonical=catalogue.get(w.id);if(!canonical)continue;if(canonical.artifactSha256!==w.sha256)throw new Error('Historical corpus differs from current contract: '+w.id);
      for(const [metric,scenario] of Object.entries({...scenarios,rss:'steady',code:'compile'})) {
        history.cells[`${w.id}|${slot}|${metric}`]=measuredHistory(weekly,snapshots,baseline.host,runtime,w.id,w.sha256,scenario).map((point,i)=>{
          const report=runtime==='wago'?snapshots.find(s=>s.runId===weekly.results[i].runId):baseline;
          const cell=weekly.results[i].status!=='measured' || !report?point.cell:metric==='rss'?measuredMemory(report,runtime,w.id,w.sha256,'steady','process.peak_rss'):metric==='code'?measuredCodeImage(report,runtime,w.id,w.sha256):point.cell;
          const factor=metric==='rss'?1024**2:metric==='code'?1024:1e6;
          const summary=report?.summaries.find(s=>s.runtime===runtime && s.workload===w.id && s.scenario===scenario && s.profile==='timing');
          return {st:status[cell.status],...(cell.status==='ok'?{v:cell.value/factor,...(cell.interval?{interval:cell.interval.map(v=>v/factor)}:{})}:{reason:reasonId(cell.reason)}),report:cell.evidence?.report || '',role:point.role,launchMedians:metric==='rss'||metric==='code'?[]:Object.values(summary?.launch_medians || {}).map(v=>v/factor)};
        });
      }
    }
  }
}
if(JSON.stringify(output.history.m1.points.map(p=>p.date))!==JSON.stringify(output.history.m2.points.map(p=>p.date)))throw new Error('Historical host dates differ');
for(const [machine,name] of [['m1','linux-x64'],['m2','darwin-arm64']]) {
  const ref=JSON.parse(await readFile(join(site,'data/threads',name+'.json')));
  const bytes=await readFile(join(site,'data/threads',ref.evidence));
  if(digest(bytes)!==ref.sha256)throw new Error('Changed worker evidence');
  const raw=JSON.parse(bytes);
  if(raw.schema!==2 || raw.results.length!==64)throw new Error('Missing dual-tier worker cohort');
  for(const mode of ['optimizing-only','liftoff-only']) {
    const variant=raw.variants?.[mode],flags=['--allow-natives-syntax',mode==='liftoff-only'?'--liftoff-only':'--no-liftoff','--no-wasm-tier-up','--no-wasm-lazy-compilation'];
    if(!variant || variant.compilerMode!==mode || variant.node!==`v${settings.node.version}` || variant.v8!==settings.node.v8 || JSON.stringify(variant.flags)!==JSON.stringify(flags) || variant.compilerModeProbe?.liftoff!==(mode==='liftoff-only') || variant.compilerModeProbe?.optimizing!==(mode==='optimizing-only'))throw new Error('Worker variant lacks its pinned eager tier lock');
    if(typeof variant.compilerModeSource!=='string' || digest(variant.compilerModeSource)!==variant.compilerModeSourceSha256 || digest(variant.collectorSource)!==variant.collectorSha256)throw new Error('Worker calibration source digest mismatch');
    const cases=raw.results.filter(r=>r.compilerMode===mode);
    if(cases.length!==32 || new Set(cases.map(r=>[r.sharing,r.workers,r.operationsPerWorker].join('|'))).size!==32)throw new Error('Incomplete worker variant cohort');
    for(const result of cases)for(const launch of result.launches) {
      if(launch.workerTierProbes?.length!==result.workers || launch.workerTierProbes.some(p=>JSON.stringify(p.flags)!==JSON.stringify(flags) || p.probe?.liftoff!==(mode==='liftoff-only') || p.probe?.optimizing!==(mode==='optimizing-only') || p.probe?.collector_version!==settings.node.v8))throw new Error('Worker tier lock was not independently calibrated');
    }
  }
  for(const result of raw.results)for(const launch of result.launches)for(const sample of launch.samples)
    if(!sample.verified || !(sample.elapsedNs>0) || sample.operations!==result.workers*result.operationsPerWorker)throw new Error('Unverified worker result');
  output.threads[machine]={created:raw.created,configuration:raw.configuration,node:raw.node,v8:raw.v8,policy:raw.policy,evidence:ref.evidence,sha256:ref.sha256,results:raw.results};
}
// Compact the browser projection without rounding a measurement or interval.
output.encoding = 'indexed-cells-v1';
output.metrics = [...Object.keys(scenarios),...Object.keys(memoryScenarios),'code'];
output.statuses = ['ok','unsupported','failed','nm'];
output.reportIds = Object.keys(output.reports);
const workloadIndex=new Map(output.catalogue.map((w,i)=>[w.id,i]));
const reportIndex=new Map(output.reportIds.map((id,i)=>[id,i]));
const slots=Object.keys(configurations);
for(const host of Object.values(output.hosts)) for(const snapshot of ['s1','s2']) {
  host.snapshots[snapshot]=Object.entries(host.snapshots[snapshot]).map(([key,c])=>{
    const fields=key.split('|');const metric=fields.pop(),slot=fields.pop(),workload=fields.join('|');
    return [workloadIndex.get(workload),slots.indexOf(slot),output.metrics.indexOf(metric),output.statuses.indexOf(c.st),reportIndex.get(c.report),c.v ?? null,c.interval ?? null,c.launchMedians ?? null,c.reason ?? null];
  });
}
for(const history of Object.values(output.history))for(const [key,cells] of Object.entries(history.cells)) {
  if(cells.every(c=>c.st==='nm'&&!c.report)){delete history.cells[key];continue;}
  history.cells[key]=cells.map(c=>[output.statuses.indexOf(c.st),reportIndex.get(c.report) ?? -1,c.v ?? null,c.interval ?? null,c.launchMedians ?? null,c.reason ?? null]);
}
await writeFile(join(site,'src/lib/data/measurements.json'),JSON.stringify(output)+'\n');
console.log(`Generated measured view catalogue: ${output.catalogue.length} contracts, ${Object.keys(output.hosts).length} hosts.`);

// Project only checksum-verified plugin suite summaries; never add their
// case counts to the performance corpus or synthesize performance samples.
const {pluginEvidence}=await import('./lib/plugin-evidence.mjs');
const pluginIndex=JSON.parse(await readFile(join(site,'data/conformance/index.json')));
const pluginReports=[];
for(const entry of pluginIndex.reports){
  if(!/^[a-f0-9]{64}\.json$/.test(entry.file))throw Error('Unsafe plugin evidence path');
  const bytes=await readFile(join(site,'data/conformance',entry.file));
  if(digest(bytes)!==entry.sha256)throw Error('Changed plugin suite evidence');
  pluginReports.push({...JSON.parse(bytes),sha256:entry.sha256});
}
const pluginViews={};
for(const [machine,os] of [['m1','linux'],['m2','darwin']])pluginViews[machine]=pluginEvidence(pluginReports,reports.find(r=>r.host.os===os).host,settings.hostAliases);
await writeFile(join(site,'src/lib/data/plugin-tests.json'),JSON.stringify(pluginViews)+'\n');
