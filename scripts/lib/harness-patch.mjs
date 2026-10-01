import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { command, site } from './wasmbench.mjs';

export function patchHarness(root) {
  for (const name of ['winch-arm64-simd.patch', 'code-preflight.patch']) {
    const patch = join(site, 'patches', name);
    const applies = args => spawnSync('git', ['apply', ...args, patch], { cwd: root, stdio: 'ignore' }).status === 0;
    if (applies(['--reverse', '--check'])) continue;
    if (!applies(['--check'])) throw new Error('Harness capability patch no longer matches. Update the recorded harness patches for the configured harness before building.');
    command('git', ['apply', patch], { cwd: root, stdio: 'inherit' });
    console.log(`Applied recorded harness patch: ${name}`);
  }
}
