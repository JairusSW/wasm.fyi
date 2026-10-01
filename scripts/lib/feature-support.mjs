import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { featureIds } from '../../corpora/features/generator.mjs';
import { digest } from './wasmbench.mjs';

// A newer targeted experiment can fill a cell from an earlier broad run only
// when every pinned runtime input and the complete description agree. Evidence
// references stay attached to each cell; versions never silently mix.
export async function featureSupport(directory, reports) {
  const hosts = new Map();
  for (const report of [...reports].sort((a,b) => b.created.localeCompare(a.created))) {
    if (!report.workloads.some(w => w.id.startsWith('features/'))) continue;
    const hostKey=JSON.stringify([report.host.hostname,report.host.os,report.host.arch]);
    if(!hosts.has(hostKey))hosts.set(hostKey,{host:report.host,configurations:new Map()});
    const host=hosts.get(hostKey);
    let raw;
    for(const runtime of report.runtimes) {
      const identity=digest(JSON.stringify({files:runtime.file_sha256,description:runtime.description}));
      if(!host.configurations.has(runtime.id))host.configurations.set(runtime.id,{id:runtime.id,identity,description:runtime.description,cases:new Map()});
      const configuration=host.configurations.get(runtime.id);
      if(configuration.identity!==identity)continue;
      raw ??= JSON.parse(await readFile(join(directory,report.evidence),'utf8'));
      for(const workload of report.workloads) {
        if(!workload.id.startsWith('features/') || workload.provenance?.baseline || configuration.cases.has(workload.id))continue;
        const trials=raw.trials.filter(t=>t.workload===workload.id && t.runtime_configuration===runtime.id);
        const errors=trials.filter(t=>!['ok','unsupported'].includes(t.status));
        const executed=trials.some(t=>t.status==='ok' && ['first-call','steady'].includes(t.scenario));
        const compiled=trials.some(t=>t.status==='ok' && t.scenario==='compile');
        const status=errors.length?'failed':executed?'executed':compiled?'compile-only':'unsupported';
        configuration.cases.set(workload.id,{workload:workload.id,artifactSha256:workload.sha256,scope:workload.provenance?.scope,status,
          scenarios:[...new Set(trials.filter(t=>t.status==='ok').map(t=>t.scenario))],
          reasons:[...new Set(trials.filter(t=>t.status!=='ok').map(t=>t.reason).filter(Boolean))],
          report:report.id,collectedAt:report.created,evidence:report.evidence,evidenceSha256:report.evidenceSha256});
      }
    }
  }
  return {schema:1,policy:'Exact corpus oracles under pinned adapter configurations; excludes scalar baselines. Compile-only evidence is distinct from execution. Unsupported and failed cases retain reasons and have no substituted performance values. Cells only combine identical pinned runtime inputs/descriptions. This is not complete specification conformance.',expectedFeatures:featureIds,
    hosts:[...hosts.values()].map(host=>({host:host.host,configurations:[...host.configurations.values()].map(configuration=>({id:configuration.id,identity:configuration.identity,description:configuration.description,
      features:featureIds.map(feature=>{
        const cases=[...configuration.cases.values()].filter(c=>c.workload.startsWith(`features/${feature}/`));
        return {id:feature,coverage:cases.length?'tested':'not-tested',cases,executed:cases.filter(c=>c.status==='executed').length,
          compiledOnly:cases.filter(c=>c.status==='compile-only').length,unsupported:cases.filter(c=>c.status==='unsupported').length,failed:cases.filter(c=>c.status==='failed').length};
      })}))}))};
}
