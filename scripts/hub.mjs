import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { verifySeal } from './lib/verify-seal.mjs';
import { fileDigest } from './lib/evidence-archive.mjs';
import { command, config, digest, harness, site } from './lib/wasmbench.mjs';

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
const options = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'ControlMaster=auto', '-o', 'ControlPersist=600', '-o', `ControlPath=${socket}`];
const ssh = (script, timeout = 120_000) => command('ssh', [...options, host.ssh, 'bash -lc ' + quote(script)], { timeout });
const remotePath = path => `${host.ssh}:${path}`;
const rsync = (args, compress = true) => command('rsync', ['-a', ...(compress ? ['-z'] : []), '-e', ['ssh', ...options.map(quote)].join(' '), ...args], { stdio: 'inherit', timeout: 30 * 60 * 1000 });
const action = process.argv[2];
if (action === 'doctor') {
  command('gtar', ['--version']); command('xz', ['--version']);
  process.stdout.write(ssh('export PATH="$HOME/.cargo/bin:$HOME/go/bin:$HOME/.local/bin:$PATH"; set -eu; uname -a; for tool in node go cargo rsync git flock tar xz; do command -v "$tool"; done; node --version; go version; cargo --version', 30_000));
} else if (['collect', 'history', 'threads'].includes(action)) {
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
  process.stdout.write(ssh(`export PATH="$HOME/.cargo/bin:$HOME/go/bin:$HOME/.local/bin:$PATH"; set -eu; for tool in node go cargo rsync git flock; do command -v "$tool"; done; mkdir -p ${quote(remote + '/harness')} ${quote(remote + '/wago')} ${quote(remote + '/site/scripts/lib')} ${quote(remote + '/site/.wasmbench')} ${quote(remote + '/site/patches')}`));
  for (const [name, source] of [['harness', root], ['wago', wago]]) {
    const files = command('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: source });
    if (!files.length) throw new Error(`No source files found for ${name}`);
    const list = join(local, `${name}-files.txt`);
    const metadata = join(site, '.wasmbench/source-metadata', id, name);
    await mkdir(join(site, '.wasmbench/source-metadata', id), { recursive: true });
    command('git', ['clone', '--bare', '--depth=1', '--filter=blob:none', '--upload-pack=git -c uploadpack.allowFilter=true upload-pack', pathToFileURL(source).href, metadata], { stdio: 'inherit' });
    rsync([metadata + '/', remotePath(remote + '/' + name + '/.git/')]);
    process.stdout.write(ssh(`set -eu; git -C ${quote(remote + '/' + name)} config core.bare false; git -C ${quote(remote + '/' + name)} reset --mixed --quiet HEAD`));
    await writeFile(list, files);
    rsync(['--from0', `--files-from=${list}`, source + '/', remotePath(remote + '/' + name + '/')]);
    await writeFile(join(local, `${name}-source.json`), JSON.stringify({ source, head: command('git', ['rev-parse', 'HEAD'], { cwd: source }).toString().trim(), status: command('git', ['status', '--porcelain'], { cwd: source }).toString() }, null, 2) + '\n');
  }
  rsync([join(site, 'scripts/history.mjs'), join(site, 'scripts/thread-workers.mjs'), join(site, 'scripts/import-wasmbench.mjs'), remotePath(remote + '/site/scripts/')]);
  rsync([join(site, 'scripts/lib/validate-data.mjs'), join(site, 'scripts/lib/snapshot-index.mjs'), join(site, 'scripts/lib/verify-seal.mjs'), join(site, 'scripts/lib/measurement-policy.mjs'), remotePath(remote + '/site/scripts/lib/')]);
  rsync([join(site, 'patches/legacy-wago-api.patch'), remotePath(remote + '/site/patches/')]);
  rsync([join(site, 'scripts/bench.mjs'), remotePath(remote + '/site/scripts/')]);
  rsync([join(site, 'scripts/wasmer-adapter.test.mjs'), remotePath(remote + '/site/scripts/')]);
  rsync([join(site, 'scripts/pack-evidence.mjs'), remotePath(remote + '/site/scripts/')]);
  rsync([join(site, 'scripts/lib/evidence-archive.mjs'), remotePath(remote + '/site/scripts/lib/')]);
  rsync([join(site, 'scripts/lib/wasmbench.mjs'), join(site, 'scripts/lib/corpus.mjs'), join(site, 'scripts/lib/harness-patch.mjs'), join(site, 'scripts/lib/feature-configurations.mjs'), remotePath(remote + '/site/scripts/lib/')]);
  rsync([join(site, 'patches/harness-capabilities.patch'), join(site, 'patches/harness-wasmer.patch'), remotePath(remote + '/site/patches/')]);
  rsync(['-r', join(site, 'corpora'), remotePath(remote + '/site/')]);
  if (action === 'history') {
    const revision = command('git',['rev-parse','HEAD'],{cwd:wago}).toString().trim();
    if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Invalid historical source revision');
    const historySource = host.historySource || '/home/hub/Code/Wago/wago';
    process.stdout.write(ssh(`set -eu; git clone --no-checkout --no-hardlinks ${quote(historySource)} ${quote(remote + '/history-source')}; git -C ${quote(remote + '/history-source')} checkout --detach ${quote(revision)}`, 10*60*1000));
    // Preserve a verified fixed-engine baseline independently of daily retention.
    rsync(['-r', join(site,'data/wasmbench'), remotePath(remote + '/site/data/')]);
  }
  const remoteConfig = join(local, 'wasmbench.config.json');
  await writeFile(remoteConfig, JSON.stringify({ ...settings, root: '../harness', collection: { ...settings.collection, wagoSource: '../wago' } }, null, 2) + '\n');
  rsync([remoteConfig, remotePath(remote + '/site/')]);
  }
  const overrides = ['WASMBENCH_RUNTIMES', 'WASMBENCH_SUITE', 'WASMBENCH_LAUNCHES', 'WASMBENCH_SAMPLES', 'WASMBENCH_OPERATIONS', 'WASMBENCH_WARMUP', 'WASMBENCH_CORPUS_IDS', 'WASMBENCH_VALIDATION_PROFILE', 'WASMBENCH_RECORD_FAILURES', 'WASMBENCH_HISTORY_ANCHOR', 'WASMBENCH_HISTORY_WEEKS']
    .filter(key => process.env[key]).map(key => `${key}=${quote(process.env[key])}`).join(' ');
  let completed = false;
  try {
    const nativeTests = process.env.WASMBENCH_SUITE?.includes('corpora/features/') && (process.env.WASMBENCH_RUNTIMES || settings.collection.featureRuntimes?.join(',') || '').includes('wasmer-') ? 'WASMBENCH_REQUIRE_WASMER_TESTS=1 node --test scripts/wasmer-adapter.test.mjs;' : '';
    const task = action === 'history' ? `WAGO_SOURCE=${quote('../history-source')} WASMBENCH_CORPUS_SOURCE=${quote('../wago')} ${overrides} node scripts/history.mjs collect; cp .wasmbench/history/results.json .wasmbench/history-results.json; cp data/history/weekly.json .wasmbench/history-weekly.json` : action === 'threads' ? `${overrides} node scripts/thread-workers.mjs; cp -r data/threads .wasmbench/threads` : `${overrides} node scripts/bench.mjs build; ${nativeTests} ${overrides} node scripts/bench.mjs doctor; ${overrides} node scripts/bench.mjs collect`;
    process.stdout.write(ssh(`export PATH="$HOME/.cargo/bin:$HOME/go/bin:$HOME/.local/bin:$PATH"; export GOFLAGS="-buildvcs=false"; set -eu; exec 9>"$HOME/${host.workspace}/measurement.lock"; flock -w 3600 9; cd ${quote(remote + '/site')}; ${task}`, 180 * 60 * 1000));
    completed = true;
  } finally {
    // Retain partial evidence too. A failed remote pass never updates site data.
    // Successful reports already contain complete sealed copies of each pass.
    // Keep all original pass directories on failure for diagnosis.
    const metadata = JSON.parse(ssh(`export PATH="$HOME/.local/bin:$PATH"; set -eu; cd ${quote(remote + '/site')}; node scripts/pack-evidence.mjs .wasmbench ../evidence.tar.xz ${completed ? '--complete' : ''}`, 20 * 60 * 1000).toString());
    const archive = join(local, 'evidence.tar.xz');
    rsync([remotePath(remote + '/evidence.tar.xz'), archive], false);
    if (await fileDigest(archive) !== metadata.sha256) throw new Error('Hub transport archive checksum mismatch');
    command('gtar', ['-xJf', archive, '-C', local], { timeout: 15 * 60 * 1000 });
    await writeFile(join(local, 'transport.json'), JSON.stringify(metadata, null, 2) + '\n');
    await rm(archive);
  }
  if (action === 'threads') {
    const { cp } = await import('node:fs/promises');
    await cp(join(local,'threads'),join(site,'data/threads'),{recursive:true});
    console.log('Retrieved independently verified Hub worker evidence');
  } else if (action === 'history') {
    const results = JSON.parse(await readFile(join(local,'history-results.json'),'utf8'));
    const paths=results.results.map(result=>join(local,'experiments',result.report.split('/').at(-2),'report'));
    command(process.execPath,['scripts/import-wasmbench.mjs','--output',join(site,'data/history-hub'),'--rebuild',...paths],{stdio:'inherit'});
    const weekly=JSON.parse(await readFile(join(local,'history-weekly.json'),'utf8'));
    // The copied fixed baseline lives in the checked-in main snapshot store.
    const { validateData } = await import('./lib/validate-data.mjs');
    const { writeIndex } = await import('./lib/snapshot-index.mjs');
    const { cp } = await import('node:fs/promises');
    const baseline=(await validateData(join(site,'data/wasmbench'))).reports.find(r=>r.id===weekly.baseline.report);
    if (!baseline) throw new Error('Missing pinned Hub historical baseline');
    await cp(join(site,'data/wasmbench',baseline.evidence),join(site,'data/history-hub',baseline.evidence));
    const index=await validateData(join(site,'data/history-hub'));
    await writeIndex(join(site,'data/history-hub'),[...index.reports,baseline]);
    await writeFile(join(site,'data/history-hub/weekly.json'),JSON.stringify(weekly,null,2)+'\n');
    console.log('Retrieved eight sealed Hub historical reports');
  } else {
  const remoteReport = (await readFile(join(local, 'latest-report.txt'), 'utf8')).trim();
  const leaf = remoteReport.split('/').at(-2);
  if (!/^[a-zA-Z0-9-]+$/.test(leaf)) throw new Error('Invalid remote experiment identity');
  const report = join(local, 'experiments', leaf, 'report');
  const { run } = await harness();
  await verifySeal(report);
  for (const path of ['raw', 'raw-memory', 'code/raw']) process.stdout.write(run('verify', '--run', join(report, path)));
  // Cross-architecture floating point reductions can differ at the final bit.
  // refresh-data rebuilds derived reports using the Mac's trusted controller.
  await writeFile(join(site, '.wasmbench/latest-hub-report.txt'), report + '\n');
  console.log(`Hub evidence retained at ${local}; remote archive retained at ~/${remote}`);
  }
} else throw new Error('Usage: node scripts/hub.mjs doctor|collect|history|threads [EXPERIMENT_TO_RESUME]');
