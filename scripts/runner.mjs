import { mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { command, digest, exists } from './lib/wasmbench.mjs';

const directory = process.env.WASMBENCH_RUNNER_DIR || join(homedir(), '.local/share/wasm-fyi/actions-runner');
const action = process.argv[2];
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('This installer targets the selected Apple Silicon Mac measurement host.');
if (action === 'status') {
  if (!await exists(join(directory, '.runner'))) console.log('Runner is not registered. Run just runner-install.');
  else process.stdout.write(command('./svc.sh', ['status'], { cwd: directory }));
} else if (action === 'install') {
  await mkdir(directory, { recursive: true });
  const repository = command('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).toString().trim();
  if (!await exists(join(directory, '.runner'))) {
    // Published upstream release digest; do not execute an unchecked download.
    const version = '2.337.0';
    const archive = join(directory, 'runner.tar.gz');
    command('curl', ['-fL', '--silent', '--show-error', `https://github.com/actions/runner/releases/download/v${version}/actions-runner-osx-arm64-${version}.tar.gz`, '-o', archive]);
    if (digest(await readFile(archive)) !== '5a2cd92908a93d7276a194e1de6008099f3e7946f3f8e14aa7a1a7b4a31fdec2') throw new Error('GitHub runner checksum mismatch');
    command('tar', ['xzf', archive, '-C', directory]);
    const token = JSON.parse(command('gh', ['api', `repos/${repository}/actions/runners/registration-token`, '-X', 'POST']).toString()).token;
    command('./config.sh', ['--unattended', '--url', `https://github.com/${repository}`, '--token', token, '--name', 'wasm-fyi-mac', '--labels', 'wasm-bench', '--work', '_work'], { cwd: directory, stdio: 'inherit' });
  }
  if (!await exists(join(directory, '.service'))) command('./svc.sh', ['install'], { cwd: directory, stdio: 'inherit' });
  command('./svc.sh', ['start'], { cwd: directory, stdio: 'inherit' });
  console.log(`Mac runner registered at ${directory}`);
} else throw new Error('Usage: node scripts/runner.mjs install|status');
