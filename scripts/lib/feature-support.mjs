import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { featureIds } from '../../corpora/features/generator.mjs';
import { digest, config } from './wasmbench.mjs';

export function runtimeIdentity(runtime) {
  return digest(JSON.stringify({command:runtime.command,files:runtime.file_sha256,hostFiles:runtime.host_file_sha256,nativePolicy:runtime.native_dependency_policy,nativeDependencies:runtime.elf_startup_dependencies,description:runtime.description}));
}
export function featureCandidates(reports,runtime,workload,sha) {
  const latest=reports.find(r=>r.workloads.some(w=>w.id.startsWith('features/')) && r.runtimes.some(c=>c.id===runtime))?.runtimes.find(c=>c.id===runtime);
  if(!latest)return [];
  const identity=runtimeIdentity(latest);
  return reports.filter(r=>r.workloads.some(w=>w.id===workload && w.sha256===sha) && r.runtimes.some(c=>c.id===runtime && runtimeIdentity(c)===identity));
}

// A newer targeted experiment can fill a cell from an earlier broad run only
// when every pinned runtime input and the complete description agree. Evidence
// references stay attached to each cell; versions never silently mix.
export function featureHostKey(host,aliases={}) {
  return JSON.stringify([aliases[host.hostname] || host.hostname,host.os,host.arch,host.cpu_description,host.logical_cpus,host.page_size,host.kernel]);
}

export async function featureSupport(directory, reports) {
  const hosts = new Map();
  const aliases=(await config()).hostAliases || {};
  const releases=JSON.parse(await readFile(new URL('../../data/feature-releases.json',import.meta.url),'utf8'));
  for (const report of [...reports].sort((a,b) => b.created.localeCompare(a.created))) {
    if (!report.workloads.some(w => w.id.startsWith('features/'))) continue;
    const hostKey=featureHostKey(report.host,aliases);
    if(!hosts.has(hostKey))hosts.set(hostKey,{host:report.host,configurations:new Map(),versions:new Map()});
    const host=hosts.get(hostKey);
    let raw;
    for(const runtime of report.runtimes) {
      const identity=runtimeIdentity(runtime);
      const key=runtime.id+'|'+identity;
      if(!host.versions.has(key))host.versions.set(key,{id:runtime.id,identity,description:runtime.description,collectedAt:report.created,...releaseTrack(runtime,releases),cases:new Map()});
      const configuration=host.versions.get(key);
      if(!host.configurations.has(runtime.id))host.configurations.set(runtime.id,configuration);
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
    hosts:[...hosts.values()].map(host=>({host:host.host,configurations:[...host.configurations.values()].map(serializeConfiguration),versions:[...host.versions.values()].map(serializeConfiguration)}))};
}
function serializeConfiguration(configuration) {
  const {cases:caseMap,...metadata}=configuration;
  return {...metadata,features:featureIds.map(feature=>{
    const cases=[...caseMap.values()].filter(c=>c.workload.startsWith(`features/${feature}/`));
    return {id:feature,coverage:cases.length?'tested':'not-tested',cases,executed:cases.filter(c=>c.status==='executed').length,
      compiledOnly:cases.filter(c=>c.status==='compile-only').length,unsupported:cases.filter(c=>c.status==='unsupported').length,failed:cases.filter(c=>c.status==='failed').length};
  })};
}
// Source provenance takes precedence even when a development build reports a
// release-looking version. Unregistered inputs cannot inherit a stable label.
export function releaseTrack(runtime,releases={identities:{}}) {
  const description=runtime.description || {},effective=description.effective_configuration || {};
  const revision=effective.engine_source_revision;
  const sourceBuild=revision || ['main','development','unreleased'].includes(effective.release_channel);
  const development=sourceBuild || /^[a-f0-9]{40}(?:\/|$)/.test(description.runtime_version || '') || /prerelease|(?:^|[-.])(?:alpha|beta|dev|rc)(?:[-.0-9]|$)/i.test(description.runtime_version || '');
  const stable=!sourceBuild && releases.identities[runtimeIdentity(runtime)];
  return {channel:stable?'stable':'development',version:stable?.version || revision || (development?description.runtime_version:'unverified · '+(description.runtime_version || 'unidentified build')),
    source:stable?.source || effective.engine_source_repository || '',revision:revision || null};
}

export function featureCasePassed(c) {
  if(c.status==='failed'||c.status==='unsupported')return false;
  const scenario=c.scope==='compile-only'?'compile':c.scope==='compile-and-instantiate'?'instantiate':'steady';
  return c.scenarios.includes(scenario);
}
