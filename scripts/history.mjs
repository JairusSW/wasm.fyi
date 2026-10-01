import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { command, config, harness, site, digest, locked, exists } from './lib/wasmbench.mjs';
import { validateData } from './lib/validate-data.mjs';
import { writeIndex } from './lib/snapshot-index.mjs';
import { prepareCorpus } from './lib/corpus.mjs';

const action = process.argv[2] || 'plan';
const settings = await config();
const source = resolve(site, process.env.WAGO_SOURCE || settings.collection.wagoSource);
const directory = join(site, '.wasmbench/history');
await mkdir(directory, { recursive: true });
const anchor = new Date(process.env.WASMBENCH_HISTORY_ANCHOR || new Date().toISOString().slice(0,10) + 'T00:00:00Z');
if (!Number.isFinite(+anchor)) throw new Error('Invalid history anchor');
const count = Number(process.env.WASMBENCH_HISTORY_WEEKS || 8);
if (!Number.isSafeInteger(count) || count < 1 || count > 52) throw new Error('History weeks must be 1..52');
const weeks = Array.from({ length: count }, (_, index) => {
  const target = new Date(+anchor - (count-index)*7*86400000).toISOString();
  const revision = command('git', ['rev-list','-1',`--before=${target}`, 'HEAD'], { cwd: source }).toString().trim();
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('No Wago revision exists before '+target);
  const revisionDate = command('git',['show','-s','--format=%cI',revision],{cwd:source}).toString().trim();
  return { targetWeek: target, revision, revisionDate };
});
const plan = { schema: 1, policy: 'Retrospective measurements of weekly Wago commits on current hosts/toolchains against one fixed corpus. collectedAt is actual collection time, never targetWeek. Comparison engines use a fixed current baseline, not reconstructed historical versions.', anchor: anchor.toISOString(), weeks };
await writeFile(join(directory,'plan.json'),JSON.stringify(plan,null,2)+'\n');
if (action === 'plan') { console.log(JSON.stringify(plan,null,2)); }
else if (action === 'collect') await locked(async () => {
  const { root, run } = await harness();
  // Remote workspaces contain source only. Build the independent analyzer once
  // before copying it into each historical adapter workspace.
  const analyzer = join(root,'adapters/wasmtime/target/release/wasm-analyze');
  if (!await exists(analyzer)) command('cargo',['build','--release','--locked','--manifest-path',join(root,'adapters/wasmtime/Cargo.toml'),'--bin','wasm-analyze'],{stdio:'inherit',env:{...process.env,CARGO_TARGET_DIR:join(root,'adapters/wasmtime/target')}});
  const baseline = await exists(join(directory,'wago-suite.json')) ? join(directory,'wago-suite.json') : await prepareCorpus(settings,run,directory);
  const fixedWorkloads = JSON.parse(await readFile(baseline,'utf8'));
  const suiteSha256 = digest(await readFile(baseline));
  const results = [];
  for (const week of weeks) {
    const worktree = join(directory,'revisions',week.revision);
    // Actions checkout can remove our files while Git retains registration in
    // the separate source repository. Recover only this missing owned path.
    if (!await exists(worktree)) command('git',['worktree','add','--force','--detach',worktree,week.revision],{cwd:source,stdio:'inherit'});
    const isolated = join(directory,'harness-'+week.revision);
    await mkdir(isolated,{recursive:true});
    const files = command('git',['ls-files','-z'],{cwd:root});
    const list = join(directory,'harness-files.txt'); await writeFile(list,files);
    command('rsync',['-a','--from0',`--files-from=${list}`,root+'/',isolated+'/']);
    // Source copies include current, reviewed adapter fixes; source engines are
    // detached original revisions. Compatibility changes affect embedding only.
    const facade = await readFile(join(worktree,'wago.go'),'utf8');
    if (!/\bWasmFunc\s*=/.test(facade)) command('git',['apply',join(site,'patches/legacy-wago-api.patch')],{cwd:isolated});
    const memoryApi = await readFile(join(worktree, 'src/wago/memory.go'), 'utf8');
    if (/func \(m \*Memory\) UnsafeBytes\(/.test(memoryApi)) {
      const { readdir } = await import('node:fs/promises');
      for (const name of await readdir(join(isolated,'adapters/wago'))) if (name.endsWith('.go')) {
        const path = join(isolated,'adapters/wago',name);
        await writeFile(path,(await readFile(path,'utf8')).replaceAll('.Memory().Bytes()', '.Memory().UnsafeBytes()'));
      }
    }
    // Reuse the independently pinned analyzer; each engine binary is built here.
    await mkdir(join(isolated,'adapters/wasmtime/target/release'),{recursive:true});
    await cp(analyzer,join(isolated,'adapters/wasmtime/target/release/wasm-analyze'));
    const env = { ...process.env, WASMBENCH_ROOT: isolated, WAGO_SOURCE: worktree, WASMBENCH_SUITE: baseline,
      WASMBENCH_RUNTIMES:'wago', WASMBENCH_RECORD_FAILURES:'1', WASMBENCH_WARMUP:'0', WASMBENCH_LAUNCHES:process.env.WASMBENCH_LAUNCHES || '3', WASMBENCH_SAMPLES:process.env.WASMBENCH_SAMPLES || '3' };
    try {
      command('go',['run','./cmd/wasmbench','build','--runtimes','wago','--wago-source',worktree],{cwd:isolated,stdio:'inherit',env:{...process.env,CARGO_TARGET_DIR:join(root,'adapters/wasmtime/target')}});
      command(process.execPath,['scripts/bench.mjs','collect'],{stdio:'inherit',env});
      const report = (await readFile(join(site,'.wasmbench/latest-report.txt'),'utf8')).trim();
      const data = JSON.parse(await readFile(join(report,'data.json'),'utf8'));
      const artifacts = data.bundle.manifest.lock.workloads;
      if (JSON.stringify(artifacts.map(w=>[w.id,w.sha256])) !== JSON.stringify(fixedWorkloads.map(w=>[w.id,w.sha256]))) throw new Error('Historical corpus drift');
      results.push({...week, status:'measured', collectedAt:data.bundle.manifest.created, failedCases:[...new Map(data.bundle.trials.filter(t=>!['ok','unsupported'].includes(t.status)).map(t=>[`${t.workload}/${t.scenario}`,{workload:t.workload,scenario:t.scenario,status:t.status,reason:t.reason}])).values()], report, reportSha256:digest(await readFile(join(report,'data.json'))), runId:data.bundle.manifest.id, suiteSha256});
    } catch (error) { results.push({...week,status:'failed',reason:error.message,suiteSha256}); }
    await writeFile(join(directory,'results.json'),JSON.stringify({...plan,results},null,2)+'\n');
  }
  const measured=results.filter(r=>r.status==='measured');
  if (measured.length) {
    command(process.execPath,['scripts/import-wasmbench.mjs','--output',join(site,'data/history'),'--rebuild',...measured.map(r=>r.report)],{stdio:'inherit'});
    const imported = await validateData(join(site,'data/history'));
    const current = await validateData(join(site,'data/wasmbench'));
    const cohort = JSON.stringify(fixedWorkloads.map(w=>[w.id,w.sha256]));
    const baselineReport = current.reports.find(r=>r.host.arch===process.arch.replace('x64','amd64') && ['wazero','wasmtime','wasmtime-winch','v8'].every(id=>r.runtimes.some(c=>c.id===id)) && JSON.stringify(r.workloads.map(w=>[w.id,w.sha256]))===cohort);
    if (!baselineReport) throw new Error('No verified fixed-engine baseline matches historical artifacts on this host');
    await cp(join(site,'data/wasmbench',baselineReport.evidence),join(site,'data/history',baselineReport.evidence));
    await writeIndex(join(site,'data/history'), [...imported.reports,baselineReport]);
    await writeFile(join(site,'data/history/weekly.json'),JSON.stringify({...plan,baseline:{report:baselineReport.id,runId:baselineReport.runId,evidenceSha256:baselineReport.evidenceSha256,created:baselineReport.created,configurations:baselineReport.runtimes.filter(r=>r.id!=='wago')},results:results.map(({report,...result})=>result)},null,2)+'\n');
  }
  if(measured.length!==weeks.length) throw new Error(`${weeks.length-measured.length} historical weeks failed; explicit gaps retained in .wasmbench/history/results.json`);
},'history');
else throw new Error('Usage: history.mjs plan|collect');
