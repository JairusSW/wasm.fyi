import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { homedir, hostname, platform, arch } from 'node:os';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { site, config, command, digest, locked, exists } from './lib/wasmbench.mjs';

const action = process.argv[2] || 'local';
const source = join(site, 'scripts/probes/wasmer-backends.c');
const artifact = join(site, 'corpora/features/artifacts/core-num-integer-multiply-add.wasm');
const hashFile = async path => digest(await readFile(path));
const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
if (action === 'local') await locked(async () => {
  const managed = join(homedir(), '.local/share/wasm-fyi/toolchains/wasmer-c-api-7.3.0/sdk');
  const sdk = resolve(process.env.WASMBENCH_WASMER_SDK || (await exists(join(managed,'build.json')) ? managed : join(homedir(), '.wasmer')));
  const library = join(sdk, 'lib', platform() === 'darwin' ? 'libwasmer.dylib' : 'libwasmer.so');
  const headers = {};
  for (const name of (await readdir(join(sdk, 'include'))).filter(name => /\.(h|hh)$/.test(name)).sort()) headers[name] = await hashFile(join(sdk, 'include', name));
  const librarySha256 = await hashFile(library);
  const manifestPath=join(sdk,'build.json');
  const buildBytes=await exists(manifestPath)?await readFile(manifestPath):null;
  const build=buildBytes?JSON.parse(buildBytes):null;
  if(build && build.librarySha256!==librarySha256)throw new Error('Managed SDK library differs from its build manifest');
  const sourceBytes = await readFile(source);
  const artifactSha256 = await hashFile(artifact);
  const directory = join(site, '.wasmbench/wasmer-preflight');
  await mkdir(directory, { recursive: true });
  const executable = join(directory, 'probe');
  const args = ['-O2', '-I', join(sdk, 'include'), source, '-L', join(sdk, 'lib'), '-lwasmer', '-Wl,-rpath,' + join(sdk, 'lib'), '-o', executable];
  command('cc', args, { stdio: 'inherit', timeout: 120_000 });
  const executableSha256 = await hashFile(executable);
  const configurations = [];
  for (const backend of ['llvm', 'singlepass']) {
    const result = spawnSync(executable, [backend, artifact], { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 });
    let response;
    try { response = JSON.parse(result.stdout); } catch { response = { status: result.signal ? 'crashed' : 'failed', reason: 'Native probe did not return a valid response.' }; }
    if (!['ok', 'unavailable', 'failed', 'crashed'].includes(response.status) || response.status === 'ok' && (result.status !== 0 || response.result !== '3' || response.backend !== backend)) throw new Error('Invalid native correctness preflight response');
    configurations.push({ id: 'wasmer-' + backend, backend, ...response, exitCode: result.status, signal: result.signal, stderr: result.stderr, error: result.error?.message });
  }
  if (librarySha256 !== await hashFile(library) || digest(sourceBytes) !== await hashFile(source)) throw new Error('SDK library or probe source changed during preflight');
  if (artifactSha256 !== await hashFile(artifact) || executableSha256 !== await hashFile(executable)) throw new Error('Artifact or probe executable changed during preflight');
  if(buildBytes && digest(buildBytes)!==await hashFile(manifestPath))throw new Error('SDK build manifest changed during preflight');
  for (const [name, sha] of Object.entries(headers)) if (sha !== await hashFile(join(sdk, 'include', name))) throw new Error('SDK headers changed during preflight');
  const report = { schema: 1, collectedAt: new Date().toISOString(), host: { hostname: hostname(), os: platform(), arch: arch() },
    scope: 'Native SDK compile, instantiate and exact integer export call. Correctness preflight only; no timing, memory, code-size or general feature-support claim.',
    artifact: { id: 'features/core-num/integer-multiply-add/1', sha256: artifactSha256, args: ['1'], oracle: { kind: 'exact_u64', expected: ['3'] } },
    sdk: { path: sdk, library, librarySha256, headers, build, buildManifestSource:buildBytes?buildBytes.toString():null, buildManifestSha256:buildBytes?digest(buildBytes):null }, compiler: { version: command('cc', ['--version']).toString().split('\n')[0], argv: ['cc', ...args] },
    collector: { source: sourceBytes.toString(), sourceSha256: digest(sourceBytes), executableSha256 }, configurations };
  const destination = join(site, 'data/wasmer-preflight');
  await mkdir(destination, { recursive: true });
  await writeFile(join(destination, platform() + '-' + arch() + '.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}, 'wasmer-preflight');
else if (action === 'hub') {
  const { hosts } = await config();
  const host = hosts.hub;
  if (!/^[a-zA-Z0-9_.@-]+$/.test(host.ssh) || !/^[a-zA-Z0-9_./-]+$/.test(host.workspace) || host.workspace.startsWith('/') || host.workspace.includes('..')) throw new Error('Invalid Hub preflight host settings');
  const sockets = join(homedir(), '.cache/wasm-fyi/ssh'); await mkdir(sockets, { recursive: true });
  const options = ['-o','BatchMode=yes','-o','ConnectTimeout=15','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3','-o','ControlMaster=auto','-o','ControlPersist=600','-o', 'ControlPath=' + join(sockets,digest(Buffer.from(site)).slice(0,12))];
  const remote = host.workspace + '/wasmer-preflight-' + randomUUID();
  const ssh = (script, timeout=120_000) => command('ssh',[...options,host.ssh,'bash -lc ' + quote(script)],{timeout});
  ssh('set -eu; mkdir -p ' + [remote+'/scripts/probes',remote+'/scripts/lib',remote+'/corpora/features/artifacts'].map(quote).join(' '));
  const copy = (files, target) => command('rsync',['-a','-e',['ssh',...options.map(quote)].join(' '),...files,host.ssh+':'+remote+'/'+target],{stdio:'inherit',timeout:120_000});
  copy([source],'scripts/probes/'); copy([artifact],'corpora/features/artifacts/');
  copy([join(site,'scripts/wasmer-preflight.mjs')],'scripts/'); copy([join(site,'scripts/lib/wasmbench.mjs')],'scripts/lib/');
  const bytes=ssh(`export PATH="$HOME/.local/bin:$PATH"; set -eu; exec 9>"$HOME/${host.workspace}/measurement.lock"; flock -w 3600 9; cd ${quote(remote)}; node scripts/wasmer-preflight.mjs local`,75*60*1000);
  const report=JSON.parse(bytes);
  if(report.host.os!=='linux' || report.host.arch!=='x64')throw new Error('Unexpected Hub preflight host');
  const destination=join(site,'data/wasmer-preflight');await mkdir(destination,{recursive:true});
  await writeFile(join(destination,'linux-x64.json'),bytes);
  console.log(bytes.toString());
} else throw new Error('Usage: wasmer-preflight.mjs local|hub');
