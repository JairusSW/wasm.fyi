import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { command, site } from './wasmbench.mjs';

export function patchHarness(root) {
  for (const name of ['harness-capabilities.patch', 'harness-wasmer.patch']) {
    const patch = join(site, 'patches', name);
    const applies = args => spawnSync('git', ['apply', ...args, patch], { cwd: root, stdio: 'ignore' }).status === 0;
    if (applies(['--reverse', '--check'])) continue;
    if (name === 'harness-wasmer.patch') {
      const legacy=join(site,'patches/harness-wasmer-legacy.patch');
      const upgrade=join(site,'patches/harness-wasmer-reset-scope.patch');
      // Upgrade only the exact previous complete patch, preserving unrelated
      // source changes instead of treating any similar guard as ours.
      if(spawnSync('git',['apply','--reverse','--check',legacy],{cwd:root,stdio:'ignore'}).status===0 && spawnSync('git',['apply','--check',upgrade],{cwd:root,stdio:'ignore'}).status===0) {
        command('git',['apply',upgrade],{cwd:root,stdio:'inherit'});
        if(!applies(['--reverse','--check']))throw new Error('Upgraded Wasmer patch does not match its recorded complete state');
        continue;
      }
    }
    if (!applies(['--check'])) throw new Error('Harness capability patch no longer matches. Update the recorded harness patches for the configured harness before building.');
    command('git', ['apply', patch], { cwd: root, stdio: 'inherit' });
    console.log(`Applied recorded harness patch: ${name}`);
  }
}
