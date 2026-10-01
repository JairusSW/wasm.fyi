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
} else if (action === 'collect') {
  command('gtar', ['--version']);
  command('xz', ['--version']);
  // Copy source files into isolated, immutable-per-experiment directories. Neither
  // host's working checkout nor another experiment is reset or cleaned.
  const id = 'hub-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
  const remote = `${host.workspace}/${id}`;
  const local = join(site, '.wasmbench/experiments', id);
  await mkdir(local, { recursive: true });
  const { root } = await harness();
  const wago = resolve(site, process.env.WAGO_SOURCE || settings.collection.wagoSource);
  process.stdout.write(ssh(`export PATH="$HOME/.cargo/bin:$HOME/go/bin:$HOME/.local/bin:$PATH"; set -eu; for tool in node go cargo rsync git flock; do command -v "$tool"; done; mkdir -p ${quote(remote + '/harness')} ${quote(remote + '/wago')} ${quote(remote + '/site/scripts/lib')} ${quote(remote + '/site/.wasmbench')} ${quote(remote + '/site/patches')}`));
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
  rsync([join(site, 'scripts/bench.mjs'), remotePath(remote + '/site/scripts/')]);
  rsync([join(site, 'scripts/pack-evidence.mjs'), remotePath(remote + '/site/scripts/')]);
  rsync([join(site, 'scripts/lib/evidence-archive.mjs'), remotePath(remote + '/site/scripts/lib/')]);
  rsync([join(site, 'scripts/lib/wasmbench.mjs'), join(site, 'scripts/lib/corpus.mjs'), join(site, 'scripts/lib/harness-patch.mjs'), remotePath(remote + '/site/scripts/lib/')]);
  rsync([join(site, 'patches/winch-arm64-simd.patch'), join(site, 'patches/code-preflight.patch'), remotePath(remote + '/site/patches/')]);
  const remoteConfig = join(local, 'wasmbench.config.json');
  await writeFile(remoteConfig, JSON.stringify({ ...settings, root: '../harness', collection: { ...settings.collection, wagoSource: '../wago' } }, null, 2) + '\n');
  rsync([remoteConfig, remotePath(remote + '/site/')]);
  const overrides = ['WASMBENCH_RUNTIMES', 'WASMBENCH_SUITE', 'WASMBENCH_LAUNCHES', 'WASMBENCH_SAMPLES', 'WASMBENCH_OPERATIONS', 'WASMBENCH_WARMUP', 'WASMBENCH_CORPUS_IDS']
    .filter(key => process.env[key]).map(key => `${key}=${quote(process.env[key])}`).join(' ');
  let completed = false;
  try {
    process.stdout.write(ssh(`export PATH="$HOME/.cargo/bin:$HOME/go/bin:$HOME/.local/bin:$PATH"; set -eu; exec 9>"$HOME/${host.workspace}/measurement.lock"; flock -n 9; cd ${quote(remote + '/site')}; ${overrides} node scripts/bench.mjs build; ${overrides} node scripts/bench.mjs doctor; ${overrides} node scripts/bench.mjs collect`, 110 * 60 * 1000));
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
} else throw new Error('Usage: node scripts/hub.mjs doctor|collect');
