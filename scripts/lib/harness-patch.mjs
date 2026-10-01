import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { command, site } from './wasmbench.mjs';

export function patchHarness(root) {
  for (const name of ['harness-capabilities.patch', 'harness-wasmer.patch', 'harness-code-profile-policy.patch']) {
    const patch = join(site, 'patches', name);
    const applies = args => spawnSync('git', ['apply', ...args, patch], { cwd: root, stdio: 'ignore' }).status === 0;
    if (applies(['--reverse', '--check'])) continue;
    if (name === 'harness-wasmer.patch') {
      // Upgrade only exact previous complete states, preserving unrelated
      // source changes instead of treating similar guards as ours.
      for(const [baseline,delta,expected] of [
        ['harness-wasmer-legacy.patch','harness-wasmer-reset-scope.patch','harness-wasmer-scoped.patch'],
        ['harness-wasmer-scoped.patch','harness-wasmer-applications.patch','harness-wasmer.patch']
      ]) {
        const check=(file,args)=>spawnSync('git',['apply',...args,join(site,'patches',file)],{cwd:root,stdio:'ignore'}).status===0;
        if(check(baseline,['--reverse','--check']) && check(delta,['--check'])) {
          command('git',['apply',join(site,'patches',delta)],{cwd:root,stdio:'inherit'});
          if(!check(expected,['--reverse','--check']))throw new Error('Upgraded Wasmer patch does not match its recorded complete state');
        }
      }
      if(applies(['--reverse','--check']))continue;
    }
    if (!applies(['--check'])) throw new Error('Harness capability patch no longer matches. Update the recorded harness patches for the configured harness before building.');
    command('git', ['apply', patch], { cwd: root, stdio: 'inherit' });
    console.log(`Applied recorded harness patch: ${name}`);
  }
}
