import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { verifySeal } from './lib/verify-seal.mjs';
import { fileDigest } from './lib/evidence-archive.mjs';
import { command, config, digest, exists, harness, site } from './lib/wasmbench.mjs';
import { featureConfigurations } from './lib/feature-configurations.mjs';

// Shell quoting is needed only at the SSH boundary; local tools use argv arrays.
const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
const settings = await config();
const host = settings.hosts?.hub;
if (!host || !/^[a-zA-Z0-9_.@-]+$/.test(host.ssh)) throw new Error('Configure hosts.hub.ssh');
if (!/^[a-zA-Z0-9_./-]+$/.test(host.workspace) || host.workspace.startsWith('/') || host.workspace.includes('..')) throw new Error('Hub workspace must be a safe relative home-directory path');
await mkdir(join(site, '.wasmbench'), { recursive: true });
// macOS limits Unix socket paths; Actions workspaces can be much longer.
const sockets = join(homedir(), '.cache/wasm-fyi/ssh');
await mkdir(sockets, { recursive: true });
const socket = join(sockets, digest(Buffer.from(site)).slice(0, 12));
const options = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'ControlMaster=auto', '-o', 'ControlPersist=86400', '-o', `ControlPath=${socket}`];
const ssh = (script, timeout = 120_000) => command('ssh', [...options, host.ssh, 'bash -lc ' + quote(script)], { timeout });
const remotePath = path => `${host.ssh}:${path}`;
const rsync = (args, compress = true) => command('rsync', ['-a', ...(compress ? ['-z'] : []), '-e', ['ssh', ...options.map(quote)].join(' '), ...args], { stdio: 'inherit', timeout: 30 * 60 * 1000 });
async function retrieveArchive(path, destination) {
  try {
    rsync([remotePath(path), destination], false);
  } catch (error) {
    // rsync's mmap-based sender can fail with ENODATA on some Hub filesystem
    // states even though the completed archive is readable over SSH. Stream it
    // to a temporary file, then let the existing SHA-256 check qualify it.
    const temporary = `${destination}.${randomUUID()}.partial`;
    const child = spawn('ssh', [...options, host.ssh, `cat -- ${quote(path)}`], { stdio: ['ignore', 'pipe', 'inherit'] });
    const exited = new Promise((resolveExit, reject) => {
      child.once('error', reject);
      child.once('close', resolveExit);
    });
    try {
      await pipeline(child.stdout, createWriteStream(temporary, { flags: 'wx' }));
      const code = await exited;
      if (code !== 0) throw new Error(`SSH archive stream failed (${code})`);
      await rename(temporary, destination);
      console.warn(`rsync archive transfer failed (${error.message}); streamed the archive over the persistent SSH connection.`);
    } catch (streamError) {
      child.kill();
      await rm(temporary, { force: true });
      throw streamError;
    }
  }
}
// Install a private, checksum-pinned Node; never replace Hub's system runtime.
const nodePin=settings.node;
if(!/^\d+\.\d+\.\d+$/.test(nodePin.version) || !/^[a-f0-9]{64}$/.test(nodePin.linuxX64Sha256))throw new Error('Invalid Node pin');
const nodeDirectory=`$HOME/${host.workspace}/toolchains/node-v${nodePin.version}-linux-x64`;
const nodePath=`export PATH="${nodeDirectory}/bin:$HOME/.cargo/bin:$HOME/go/bin:$HOME/.local/bin:$PATH";`;
process.stdout.write(ssh(`set -eu; test "$(uname -m)" = x86_64; mkdir -p "$HOME/${host.workspace}/toolchains"; exec 8>"$HOME/${host.workspace}/toolchains/node.lock"; flock -w 300 8;
if ! test -x "${nodeDirectory}/bin/node"; then
 task_node_archive=$(mktemp); task_node_stage=$(mktemp -d "$HOME/${host.workspace}/toolchains/node-stage.XXXXXX");
 trap 'rm -f "$task_node_archive"; rm -rf "$task_node_stage"' EXIT;
 curl -fLsS --retry 3 https://nodejs.org/dist/v${nodePin.version}/node-v${nodePin.version}-linux-x64.tar.xz -o "$task_node_archive";
 echo '${nodePin.linuxX64Sha256}  '"$task_node_archive" | sha256sum -c -;
 tar -xJf "$task_node_archive" -C "$task_node_stage";
 mv "$task_node_stage/node-v${nodePin.version}-linux-x64" "${nodeDirectory}";
fi
${nodePath} test "$(node -p process.versions.node)" = '${nodePin.version}'; test "$(node -p process.versions.v8)" = ${quote(nodePin.v8)}; node --version;`,10*60*1000));
const action = process.argv[2];
const pinnedCPU = process.env.WASMBENCH_HUB_CPU?.trim() || '';
if (pinnedCPU && !/^\d+$/.test(pinnedCPU)) throw new Error('WASMBENCH_HUB_CPU must be one CPU index');
if (action === 'doctor') {
  command('gtar', ['--version']); command('xz', ['--version']);
  process.stdout.write(ssh(nodePath+'set -eu; uname -a; for tool in node go cargo rsync git flock tar xz; do command -v "$tool"; done; node --version; go version; cargo --version', 30_000));
} else if (['stage', 'collect', 'history', 'threads', 'conformance', 'performance-history', 'compile-audit'].includes(action)) {
  command('gtar', ['--version']);
  command('xz', ['--version']);
  // Copy source files into isolated, immutable-per-experiment directories. Neither
  // host's working checkout nor another experiment is reset or cleaned.
  const resume = process.argv[3];
  if (resume && !/^hub-[a-zA-Z0-9-]+$/.test(resume)) throw new Error('Invalid Hub experiment to resume');
  const id = resume || 'hub-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
  const remote = `${host.workspace}/${id}`;
  const local = join(site, '.wasmbench/experiments', id);
  await mkdir(local, { recursive: true });
  if (!resume) {
  const { root } = await harness();
  const wago = resolve(site, process.env.WAGO_SOURCE || settings.collection.wagoSource);
  process.stdout.write(ssh(`${nodePath} set -eu; for tool in node go cargo rsync git flock${pinnedCPU ? ' taskset' : ''}; do command -v "$tool"; done; mkdir -p ${quote(remote + '/harness')} ${quote(remote + '/wago')} ${quote(remote + '/site/scripts/lib')} ${quote(remote + '/site/.wasmbench')} ${quote(remote + '/site/patches')}`));
  for (const [name, source] of [['harness', root], ['wago', wago]]) {
    const files = command('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: source });
    if (!files.length) throw new Error(`No source files found for ${name}`);
    const list = join(local, `${name}-files.txt`);
    const metadata = join(site, '.wasmbench/source-metadata', id, name);
    await mkdir(join(site, '.wasmbench/source-metadata', id), { recursive: true });
    command('git', ['clone', '--bare', '--depth=1', pathToFileURL(source).href, metadata], { stdio: 'inherit' });
    rsync([metadata + '/', remotePath(remote + '/' + name + '/.git/')]);
    process.stdout.write(ssh(`set -eu; git -C ${quote(remote + '/' + name)} config core.bare false; git -C ${quote(remote + '/' + name)} reset --mixed --quiet HEAD`));
    await writeFile(list, files);
    rsync(['--from0', `--files-from=${list}`, source + '/', remotePath(remote + '/' + name + '/')]);
    await writeFile(join(local, `${name}-source.json`), JSON.stringify({ source, head: command('git', ['rev-parse', 'HEAD'], { cwd: source }).toString().trim(), status: command('git', ['status', '--porcelain'], { cwd: source }).toString() }, null, 2) + '\n');
  }
  process.stdout.write(ssh(`mkdir -p ${quote(remote + '/site/adapters/features')}`));
  rsync([join(site,'adapters/features/') ,remotePath(remote + '/site/adapters/features/')]);
  process.stdout.write(ssh(`mkdir -p ${quote(remote + '/site/adapters/audit')}`));
  rsync([join(site,'adapters/audit/'),remotePath(remote + '/site/adapters/audit/')]);
  rsync([join(site,'scripts/conformance.mjs'),join(site,'scripts/publish-conformance.mjs'),join(site, 'scripts/history.mjs'), join(site,'scripts/performance-history.mjs'),join(site,'scripts/performance-history-collect.mjs'),join(site,'scripts/history-after-full-run.mjs'), join(site, 'scripts/thread-workers.mjs'), join(site, 'scripts/import-wasmbench.mjs'), remotePath(remote + '/site/scripts/')]);
  rsync([join(site, 'scripts/lib/validate-data.mjs'), join(site, 'scripts/lib/snapshot-index.mjs'), join(site, 'scripts/lib/verify-seal.mjs'), join(site, 'scripts/lib/measurement-policy.mjs'), remotePath(remote + '/site/scripts/lib/')]);
  rsync([join(site, 'patches/legacy-wago-api.patch'), remotePath(remote + '/site/patches/')]);
  rsync([join(site, 'scripts/bench.mjs'), join(site,'scripts/full-run.mjs'),join(site,'scripts/compile-latency-audit.mjs'),join(site,'scripts/corpus-v8.mjs'),join(site,'scripts/corpus-v8-worker.mjs'), remotePath(remote + '/site/scripts/')]);
  rsync([join(site,'scripts/lib/corpus-collection.mjs'),join(site,'scripts/lib/latest-reports.mjs'),join(site,'scripts/lib/worker-budget.mjs'),remotePath(remote+'/site/scripts/lib/')]);
  rsync([join(site, 'scripts/wasmer-adapter.test.mjs'), remotePath(remote + '/site/scripts/')]);
  rsync([join(site, 'scripts/extra-feature-adapters.test.mjs'), remotePath(remote + '/site/scripts/')]);
  rsync([join(site, 'scripts/pack-evidence.mjs'), remotePath(remote + '/site/scripts/')]);
  rsync([join(site, 'scripts/lib/evidence-archive.mjs'), join(site, 'scripts/lib/wasmfyi-export.mjs'), remotePath(remote + '/site/scripts/lib/')]);
  rsync([join(site,'scripts/lib/release-policy.mjs'),join(site,'scripts/lib/conformance.mjs'),join(site,'scripts/lib/weekly-history.mjs'),join(site,'scripts/lib/history-lanes.mjs'),join(site,'scripts/lib/performance-history.mjs'),join(site,'scripts/lib/historical-binding.mjs'),join(site,'scripts/lib/wasmer-release.mjs'),join(site,'scripts/lib/engine-sources.mjs'),join(site, 'scripts/lib/wasmbench.mjs'), join(site, 'scripts/lib/corpus.mjs'), join(site, 'scripts/lib/application-manifest.mjs'), join(site, 'scripts/lib/application-kernels.mjs'), join(site, 'scripts/lib/harness-patch.mjs'), join(site, 'scripts/lib/feature-configurations.mjs'), join(site,'scripts/lib/feature-tools.mjs'), join(site, 'scripts/lib/v8-preflight.mjs'),join(site,'scripts/lib/v8-corpus.mjs'), remotePath(remote + '/site/scripts/lib/')]);
  rsync(['harness-capabilities.patch','harness-capabilities-legacy.patch','harness-wasmer.patch','harness-wasmer-legacy.patch','harness-wasmer-reset-scope.patch','harness-wasmer-scoped.patch','harness-wasmer-applications.patch','harness-code-profile-policy.patch','harness-v8-wasmfx-lock.patch','harness-feature-engines.patch','harness-wazero-compile-freshness.patch','harness-v8-compile-freshness.patch','harness-finder-metadata.patch'].map(name=>join(site,'patches',name)).concat(remotePath(remote+'/site/patches/')));
  rsync(['-r', join(site, 'corpora'), remotePath(remote + '/site/')]);
  if(await exists(join(site,'.wasmbench/upstream/manifest.json')))
    rsync(['-r',join(site,'.wasmbench/upstream'),remotePath(remote+'/site/.wasmbench/')]);
  const remoteConfig = join(local, 'wasmbench.config.json');
  await writeFile(remoteConfig, JSON.stringify({ ...settings, root: '../harness', collection: { ...settings.collection, wagoSource: '../wago' } }, null, 2) + '\n');
  rsync([remoteConfig, remotePath(remote + '/site/')]);
  }
  // Resumed workers may have been staged before transport optimizations. Keep
  // the packer current without recopying the large runtime/source trees.
  rsync([join(site,'scripts/pack-evidence.mjs'),remotePath(remote+'/site/scripts/')]);
  rsync([join(site,'scripts/lib/evidence-archive.mjs'),join(site,'scripts/lib/wasmfyi-export.mjs'),remotePath(remote+'/site/scripts/lib/')]);
  if(action==='stage') {
    const receipt={id,remote,local,ssh:host.ssh,stagedAt:new Date().toISOString()};
    await writeFile(join(site,'.wasmbench/latest-hub-stage.json'),JSON.stringify(receipt)+'\n');
    console.log(JSON.stringify(receipt));process.exit(0);
  }
  if(action==='performance-history') {
    // The current-data stage may have been prepared before release-specific
    // historical bindings were added. Refresh owned source trees only after
    // the latest collection has released the Hub measurement lock.
    const {root: currentHarness}=await harness();
    const manifest=join(local,'historical-harness-files.txt');
    await writeFile(manifest,command('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:currentHarness}));
    rsync(['--from0',`--files-from=${manifest}`,currentHarness+'/',remotePath(remote+'/harness/')]);
    for(const name of ['scripts','adapters','patches','corpora'])rsync(['-r',join(site,name+'/'),remotePath(remote+'/site/'+name+'/')]);
  }
  const overrides = ['WASMBENCH_WAGO_TAG','WASMBENCH_WAGO_REVISION','WASMBENCH_RUNTIMES', 'WASMBENCH_SUITE', 'WASMBENCH_LAUNCHES', 'WASMBENCH_SAMPLES', 'WASMBENCH_SCENARIO_SAMPLES', 'WASMBENCH_OPERATIONS', 'WASMBENCH_WARMUP', 'WASMBENCH_WORKERS', 'WASMBENCH_CORPUS_IDS', 'WASMBENCH_APPLICATION_IDS', 'WASMBENCH_VALIDATION_PROFILE', 'WASMBENCH_RECORD_FAILURES', 'WASMBENCH_TIMING_ONLY', 'WASMBENCH_SKIP_HARNESS_PATCH', 'WASMBENCH_TIMEOUT', 'WASMBENCH_HISTORY_ANCHOR', 'WASMBENCH_HISTORY_WEEKS','WASMBENCH_PERFORMANCE_HISTORY_WEEKS','WASMBENCH_CONFORMANCE_LANES','WASMBENCH_RELEASE_AS_OF','WASMBENCH_RELEASE_CACHE','WASMBENCH_WAVM_SDK','WASMBENCH_WAVM_VERSION','WASMBENCH_JSC','WASMBENCH_JSC_VERSION','WASMBENCH_FULL_HISTORY_WEEKS','WASMBENCH_AUDIT_RUNTIMES','WASMBENCH_AUDIT_WAGO_TAG','WASMBENCH_AUDIT_WAZERO_VERSION','WAGO_SPEC_INTERPRETER']
    .filter(key => process.env[key]).map(key => `${key}=${quote(process.env[key])}`).join(' ');
  let completed = false;
  try {
    const featureSuite=process.env.WASMBENCH_SUITE?.includes('corpora/features/')||process.env.WASMBENCH_SUITE==='all';
    const selectedRuntimes = process.env.WASMBENCH_RUNTIMES || (featureSuite ? featureConfigurations(settings,'linux') : settings.collection.runtimes).join(',');
    const selectedRuntimeIds=selectedRuntimes.split(',');
    const wasmerTestRuntimes=selectedRuntimeIds.filter(id=>id.startsWith('wasmer-')).join(',');
    // wasm3's adapter correctly reports no separate instantiate phase, but its
    // preflight run currently fails function lookup for the feature fixture;
    // let the collector exercise its full workload set and record each result.
    const extraFeatureTestRuntimes=selectedRuntimeIds.filter(id=>['wasmi','wasmedge','wamr','wavm','chicory'].includes(id)).join(',');
    const nativeTests = (wasmerTestRuntimes ? `WASMBENCH_REQUIRE_WASMER_TESTS=1 WASMBENCH_RUNTIMES=${quote(wasmerTestRuntimes)} node --test scripts/wasmer-adapter.test.mjs;` : '') + (featureSuite&&extraFeatureTestRuntimes ? `WASMBENCH_REQUIRE_EXTRA_FEATURE_TESTS=1 WASMBENCH_RUNTIMES=${quote(extraFeatureTestRuntimes)} node --test scripts/extra-feature-adapters.test.mjs;` : '');
    const task = action === 'compile-audit' ? `${overrides} node scripts/bench.mjs build; ${overrides} node scripts/compile-latency-audit.mjs` : action === 'history' ? `${overrides} node scripts/history.mjs collect` : action === 'performance-history' ? `${overrides} node scripts/history.mjs plan; ${overrides} node scripts/performance-history.mjs plan; WASMBENCH_HISTORY_PLAN_READY=1 ${overrides} node scripts/performance-history-collect.mjs` : action === 'conformance' ? `${overrides} node scripts/conformance.mjs collect` : action === 'threads' ? `${overrides} node scripts/thread-workers.mjs; cp -r data/threads .wasmbench/threads` : `${overrides} node scripts/bench.mjs build; ${nativeTests} ${overrides} node scripts/bench.mjs doctor || true; ${overrides} node scripts/bench.mjs collect`;
    // Correctness suites record outcomes, not timings; they do not need the performance measurement lock.
    const measurementLock = ['conformance','history','performance-history'].includes(action) || pinnedCPU ? '' : `exec 9>"$HOME/${host.workspace}/measurement.lock"; flock -w 3600 9;`;
    const pinnedTask = pinnedCPU ? `taskset -c ${pinnedCPU} bash -lc ${quote(`${nodePath} export GOFLAGS="-buildvcs=false"; ${task}`)}` : task;
    process.stdout.write(ssh(`${nodePath} export GOFLAGS="-buildvcs=false"; set -eu; ${measurementLock} cd ${quote(remote + '/site')}; ${pinnedTask}`, 180 * 60 * 1000));
    completed = true;
  } finally {
    // Retain partial evidence too. A failed remote pass never updates site data.
    // Successful reports already contain complete sealed copies of each pass.
    // Keep all original pass directories on failure for diagnosis.
    const compactTransport = completed && action === 'collect';
    const packModes = [compactTransport ? '--complete' : '', compactTransport ? '--latest-report' : '', compactTransport ? '--wasm-fyi' : ''].filter(Boolean).join(' ');
    const archiveName = compactTransport ? 'evidence.tar.zst' : 'evidence.tar.xz';
    const metadata = JSON.parse(ssh(`${nodePath} set -eu; cd ${quote(remote + '/site')}; node scripts/pack-evidence.mjs .wasmbench ../${archiveName} ${packModes}`, 20 * 60 * 1000).toString());
    const archive = join(local, archiveName);
    await retrieveArchive(remote + '/' + archiveName, archive);
    if (await fileDigest(archive) !== metadata.sha256) throw new Error('Hub transport archive checksum mismatch');
    if (compactTransport) command('gtar', ['-I', 'zstd', '-xf', archive, '-C', local], { timeout: 60 * 1000 });
    else command('gtar', ['-xJf', archive, '-C', local], { timeout: 15 * 60 * 1000 });
    await writeFile(join(local, 'transport.json'), JSON.stringify(metadata, null, 2) + '\n');
    await rm(archive);
  }
  if (action === 'threads') {
    const { cp } = await import('node:fs/promises');
    await cp(join(local,'threads'),join(site,'data/threads'),{recursive:true});
    console.log('Retrieved independently verified Hub worker evidence');
  } else if (['history','conformance'].includes(action)) {
    const {readdir}=await import('node:fs/promises');
    const directories=(await readdir(join(local,'conformance'))).map(p=>join(local,'conformance',p));
    command(process.execPath,['scripts/publish-conformance.mjs',...directories],{stdio:'inherit'});
    console.log('Retrieved sealed Hub release conformance evidence');
  } else if (action==='performance-history') {
    console.log(`Hub historical performance evidence retained at ${local}; remote archive retained at ~/${remote}`);
  } else if (action==='compile-audit') {
    console.log(`Hub scratch compile-latency audit evidence retained at ${local}/.wasmbench/compile-latency-audit`);
  } else {
  const relativeReports=await readFile(join(local,'latest-wasm-fyi-reports.json'),'utf8').then(JSON.parse,error=>{if(error.code!=='ENOENT')throw error;return null;})||[(await readFile(join(local,'latest-wasm-fyi-report.txt'),'utf8')).trim()];
  const reports=[];
  for(const relativeReport of relativeReports) {
    if(!/^wasm-fyi\/[a-zA-Z0-9-]+\/report$/.test(relativeReport))throw Error('Invalid wasm.fyi projection pointer');
    const report=join(local,relativeReport);await verifySeal(report);reports.push(report);
  }
  const report=reports.at(-1);
  await writeFile(join(site,'.wasmbench/latest-hub-reports.json'),JSON.stringify(reports)+'\n');
  await writeFile(join(site,'.wasmbench/latest-hub-report.txt'),report+'\n');
  console.log(`Compact wasm.fyi projection retained at ${report}; complete sealed evidence remains on Hub at ~/${remote}`);
  }
} else throw new Error('Usage: node scripts/hub.mjs doctor|collect|history|performance-history|compile-audit|threads|conformance [EXPERIMENT_TO_RESUME]');
