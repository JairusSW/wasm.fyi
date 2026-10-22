import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { featureIds } from '../../corpora/features/generator.mjs';
import { digest, config } from './wasmbench.mjs';

// Metadata consumption and JS-specific host integration need applicable
// declarations: ordinary binary compilation/execution can pass without either.
// Require the pinned adapter configuration to declare the capability before
// publishing support; retain the original semantic-control observations.
export const declarationRequiredFeatures = new Set(['branch-hinting','compilation-hints','instrument-and-tracing-technology','big-int','extended-name-section','custom-annotation-syntax-in-the-text-format','numeric-values-in-wat']);
const declarationKeys={'branch-hinting':'BRANCH_HINTING','compilation-hints':'COMPILATION_HINTS','instrument-and-tracing-technology':'INSTRUCTION_TRACING'};
export function runtimeDeclaresFeature(description,feature) {
  // The numeric oracle exercises JS BigInt only through these JS adapters.
  if(feature==='big-int')return ['v8','spidermonkey','jsc'].includes(description?.runtime);
  // This pinned OMG source parses branch metadata and consumes it when
  // weighting branches. Other tiers/revisions need their own source audit.
  if(feature==='branch-hinting'&&description?.runtime==='jsc'
    &&description?.backend==='OMG (forced tier-up)'
    &&description?.runtime_version==='f3e56c5b480ab4dc6bb6412abdfc35c2536467ec')return true;
  if(description?.features?.includes(feature))return true;
  if(description?.validator_features?.[feature.replaceAll('-','_')]===true)return true;
  if(description?.validator_features?.supported?.[declarationKeys[feature]]===true)return true;
  const effective=description?.effective_configuration||{},flags=String(effective.flags||'');
  if(feature==='branch-hinting'&&flags.includes('"--experimental-wasm-branch-hinting"'))return true;
  if(feature==='compilation-hints'&&flags.includes('"--experimental-wasm-compilation-hints"'))return true;
  if(feature==='instrument-and-tracing-technology'&&flags.includes('"--experimental-wasm-instruction-tracing"'))return true;
  // Pinned Graal source: BinaryParser consumes metadata.code.branch_hint;
  // RuntimeBytecodeGen seeds branch profiles consumed by WasmFunctionNode.
  // This revision enables it unconditionally; do not infer it for other SDKs.
  if(feature==='branch-hinting'&&description?.runtime==='graalwasm'
    &&description?.backend==='truffle-graal'
    &&description?.runtime_version==='f1dce3f84de778485d0ba8d6ddfd4d260b230d0a')return true;
  // Wasmtime's pinned validator receipt predates the structured branch-hint
  // key. Its evidence names the enabled Cranelift implementation explicitly;
  // Winch parses the ignorable section but does not consume its code-layout
  // hint, so keep this backend-specific.
  return feature==='branch-hinting'&&description?.backend==='cranelift'
    &&effective.validator_feature_policy==='wasmtime-default-subset-v1'
    &&String(description?.validator_features?.evidence||'').includes('explicitly enables branch hints');
}

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
  const releases=await readFile(new URL('../../data/feature-releases.json',import.meta.url),'utf8').then(JSON.parse,error=>{if(error.code!=='ENOENT')throw error;return {identities:{}};});
  for (const report of [...reports].sort((a,b) => b.created.localeCompare(a.created))) {
    if (!report.workloads.some(w => w.id.startsWith('features/'))) continue;
    const hostKey=featureHostKey(report.host,aliases);
    if(!hosts.has(hostKey))hosts.set(hostKey,{host:report.host,configurations:new Map(),versions:new Map()});
    const host=hosts.get(hostKey);
    const raw=JSON.parse(await readFile(join(directory,report.evidence),'utf8'));
    const trialPayload = raw.trialsEvidence ? JSON.parse(await readFile(join(directory,raw.trialsEvidence),'utf8')) : raw;
    const trials = trialPayload.schema === 'interned-columns-v1'
      ? trialPayload.trials.map(t => ({runtime_configuration:trialPayload.strings[t[1]], workload:trialPayload.strings[t[2]],
        scenario:trialPayload.strings[t[3]], status:trialPayload.strings[t[6]], reason:t[7] == null ? null : trialPayload.strings[t[7]]}))
      : raw.trialSchema === 'columns-v1'
        ? raw.trials.map(([id, runtime_configuration, workload, scenario, profile, block, status, reason]) =>
          ({id, runtime_configuration, workload, scenario, profile, block, status, reason}))
      : raw.trials;
    for(const runtime of report.runtimes) {
      const identity=runtimeIdentity(runtime);
      const key=runtime.id+'|'+identity;
      if(!host.versions.has(key))host.versions.set(key,{id:runtime.id,identity,description:runtime.description,collectedAt:report.created,...releaseTrack(runtime,releases),cases:new Map()});
      const configuration=host.versions.get(key);
      if(!host.configurations.has(runtime.id))host.configurations.set(runtime.id,configuration);
      for(const workload of report.workloads) {
        if(!workload.id.startsWith('features/') || workload.provenance?.baseline || configuration.cases.has(workload.id))continue;
        const cases=trials.filter(t=>t.workload===workload.id && t.runtime_configuration===runtime.id);
        const errors=cases.filter(t=>!['ok','unsupported'].includes(t.status));
        const executed=cases.some(t=>t.status==='ok' && ['first-call','steady'].includes(t.scenario));
        const compiled=cases.some(t=>t.status==='ok' && t.scenario==='compile');
        const required=(workload.features || []).filter(feature=>declarationRequiredFeatures.has(feature));
        const missing=required.filter(feature=>!runtimeDeclaresFeature(runtime.description,feature));
        const status=errors.length?'failed':missing.length?'unsupported':executed?'executed':compiled?'compile-only':'unsupported';
        configuration.cases.set(workload.id,{workload:workload.id,artifactSha256:workload.sha256,scope:workload.provenance?.scope,status,
          scenarios:[...new Set(cases.filter(t=>t.status==='ok').map(t=>t.scenario))],
          reasons:[...new Set([...cases.filter(t=>t.status!=='ok').map(t=>t.reason).filter(Boolean),...missing.map(feature=>`Pinned runtime configuration does not declare ${feature} enabled`)])],
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

// Historical evidence remains archived, but cannot prove a changed probe.
export function matchesCurrentFeature(workload, manifest) {
  const current=manifest.get(workload.id);
  return !!current && current.sha256 === workload.sha256;
}
