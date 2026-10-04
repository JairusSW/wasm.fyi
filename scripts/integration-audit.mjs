// Audit the current view contracts against published measurements.
// Similar names never establish identical workload semantics or engine backends.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';
import { command, site } from './lib/wasmbench.mjs';
import { validateData } from './lib/validate-data.mjs';

command(process.execPath,['scripts/view-data.mjs']);
const generated=await readFile(join(site,'src/lib/data/measurements.json'),'utf8');
const providerSource=await readFile(join(site,'src/lib/view-data.ts'),'utf8');
const providerJs=ts.transpileModule(providerSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/import input from ['"]\.\/data\/measurements\.json['"];?/,()=>`const input=${generated};`);
const providerUri='data:text/javascript;base64,'+Buffer.from(providerJs).toString('base64');
async function dataModule(name) {
  const source = await readFile(join(site, 'src/lib/data', name + '.ts'), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  return import('data:text/javascript;base64,' + Buffer.from(outputText.replace(/['"]\.\.\/view-data['"]/g,()=>JSON.stringify(providerUri))).toString('base64'));
}
const { CFG } = await dataModule('runtimes');
const { ALLB } = await dataModule('snapshot');
const { reports } = await validateData(join(site, 'data/wasmbench'));
const runtimeIds = { A: 'wasmtime', D: 'wasmer-singlepass', E: 'wazero', F: 'v8', G: 'wago', L: 'wavm' };
const configurations = CFG.map(cfg => {
  const matches = reports.flatMap(report => report.runtimes.filter(runtime => runtime.id === runtimeIds[cfg.id]).map(runtime => ({ host: report.host.os + '/' + report.host.arch, backend: runtime.description.backend, version: runtime.description.runtime_version })));
  const measured = [...new Map(matches.map(match => [JSON.stringify(match), match])).values()];
  return { viewId: cfg.id, runtime: cfg.rt, displayedBackend: cfg.be, displayedVersion: cfg.ver, measured, backendMatches: measured.length > 0 && measured.every(match => match.backend === ({F:'optimizing-only',H:'liftoff-only'}[cfg.id] || cfg.be)) };
});
const ids = new Set(reports.flatMap(report => report.workloads.map(workload => workload.id+'|'+workload.sha256)));
const workloads = ALLB.map(workload => ({ id: workload.id, artifactSha256:workload.artifactSha256, exactMeasuredContract: ids.has(workload.id+'|'+workload.artifactSha256) }));
console.log(JSON.stringify({ policy: 'Exact identifiers and backend identities only. A similar workload name is not proof of equivalent input, oracle, or measurement contract. Published evidence does not prove that an existing view consumes it; inspect view wiring separately.', configurations, workloads }, null, 2));
