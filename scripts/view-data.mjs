import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { digest, site } from './lib/wasmbench.mjs';
import { validateData } from './lib/validate-data.mjs';
import { measuredTiming, measuredMemory, measuredCodeImage } from '../src/lib/measured.ts';

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
const configurations = { A:'wasmtime', B:'wasmtime-winch', C:'wasmer-llvm', D:'wasmer-singlepass', E:'wazero', F:'v8', G:'wago' };
const scenarios = { compile:'compile', inst:'instantiate', first:'first-call', steady:'steady' };
const catalogue = new Map();
for (const report of reports) for (const w of report.workloads) {
  if (!/^(wago|features)\//.test(w.id) || catalogue.has(w.id)) continue;
  const structure = report.artifactStructures?.find(a=>a.sha256===w.sha256);
  if(!structure || !Number.isSafeInteger(structure.bytes) || structure.bytes < 8)throw new Error('Missing measured artifact size: '+w.id);
  const baselineReport=reports.find(r=>r.runtimes.some(c=>c.id==='wasmtime') && r.workloads.some(item=>item.id===w.id && item.sha256===w.sha256));
  const baseline=baselineReport?measuredTiming(baselineReport,'wasmtime',w.id,w.sha256,'steady'):null;
  catalogue.set(w.id, {
    id:w.id, artifactSha256:w.sha256, tags:[...(w.features || []),...(w.original_contract?.tags || [])],
    kb:structure.bytes/1024, ms:baseline?.status==='ok'?baseline.value/1e6:null,
    group:w.id.startsWith('wago/')?'Wago applications':`Features · ${w.provenance?.feature || w.features?.[0] || 'baseline'}`,
    purpose:w.original_contract?.desc || `${w.provenance?.scope || w.abi} · ${w.work_unit} · ${w.units_per_invocation} units/invocation`,
    input:JSON.stringify(w.args || w.vectors || []), src:w.source || w.generator,
    unitsPerInvocation:w.units_per_invocation, workUnit:w.work_unit
  });
}
const reasons=new Map();
function reasonId(reason) { if(!reasons.has(reason)){reasons.set(reason,reasons.size);output.reasons.push(reason);}return reasons.get(reason); }
const status = { ok:'ok', unsupported:'unsupported', failed:'failed', 'not-measured':'nm', 'not-collected':'nm' };
const output = { schema:1, configurations, catalogue:[...catalogue.values()], hosts:{}, reports:{}, reasons:[] };
for (const report of reports) output.reports[report.id] = { runId:report.runId, created:report.created, evidence:report.evidence, sha256:report.evidenceSha256, options:report.options };
for (const [machine, os] of [['m1','linux'],['m2','darwin']]) {
  const selected = reports.filter(r=>r.host.os===os);
  if (!selected.length) throw new Error('Missing measured host: '+os);
  const host = selected[0].host;
  // These selector slots retain their URL encoding; their facts are measured.
  const view = { label:`${host.cpu_description} · ${host.hostname}`, os:`${host.os}/${host.arch} · ${host.kernel}`, policy:host.policy, configurations:{}, snapshots:{s1:{},s2:{}} };
  output.hosts[machine]=view;
  for (const [slot,runtime] of Object.entries(configurations)) {
    const config=selected.flatMap(r=>r.runtimes).find(c=>c.id===runtime);
    if (config) view.configurations[slot]={ runtime, version:config.description.runtime_version, backend:config.description.backend };
    for (const workload of output.catalogue) {
      // A newer failed/unsupported result wins. Never backfill it with a success.
      const candidates=selected.filter(r=>r.runtimes.some(c=>c.id===runtime) && r.workloads.some(w=>w.id===workload.id && w.sha256===workload.artifactSha256));
      for (const [i,snapshot] of ['s1','s2'].entries()) {
        const report=candidates[i];
        if (!report) continue;
        for (const metric of [...Object.keys(scenarios),'rss','code']) {
          const cell=metric==='rss'?measuredMemory(report,runtime,workload.id,workload.artifactSha256,'steady','process.peak_rss'):
            metric==='code'?measuredCodeImage(report,runtime,workload.id,workload.artifactSha256):
            measuredTiming(report,runtime,workload.id,workload.artifactSha256,scenarios[metric]);
          const factor=metric==='rss'?1024**2:metric==='code'?1024:1e6;
          const summary=report.summaries.find(s=>s.runtime===runtime && s.workload===workload.id && s.scenario===(scenarios[metric] || 'steady') && s.profile==='timing');
          view.snapshots[snapshot][`${workload.id}|${slot}|${metric}`]={st:status[cell.status], ...(cell.status==='ok'?{v:cell.value/factor, ...(cell.interval?{interval:cell.interval.map(v=>v/factor)}:{})}:{reason:reasonId(cell.reason)}),report:report.id,
            ...(summary?{launchMedians:Object.values(summary.launch_medians || {}).map(v=>v/1e6)}:{})};
        }
      }
    }
  }
}
// Compact the browser projection without rounding a measurement or interval.
output.encoding = 'indexed-cells-v1';
output.metrics = [...Object.keys(scenarios),'rss','code'];
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
await writeFile(join(site,'src/lib/data/measurements.json'),JSON.stringify(output)+'\n');
console.log(`Generated measured view catalogue: ${output.catalogue.length} contracts, ${Object.keys(output.hosts).length} hosts.`);
