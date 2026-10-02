import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { command, site } from './wasmbench.mjs';

function patchBase(root) {
  // The final feature layer overlaps earlier native-adapter hunks. Temporarily
  // peel only its exact recorded state to verify those layers, then restore it
  // even when a preceding check fails. Unrelated edits are never reset.
  const feature=join(site,'patches/harness-feature-engines.patch');
  const featureCheck=args=>spawnSync('git',['apply',...args,feature],{cwd:root,stdio:'ignore'}).status===0;
  const featureApplied=featureCheck(['--reverse','--check']);
  if(featureApplied)command('git',['apply','--reverse',feature],{cwd:root});
  try {
    for (const name of ['harness-capabilities.patch', 'harness-wasmer.patch', 'harness-code-profile-policy.patch']) {
      const patch = join(site, 'patches', name);
      const applies = args => spawnSync('git', ['apply', ...args, patch], { cwd: root, stdio: 'ignore' }).status === 0;
      if (applies(['--reverse', '--check'])) continue;
      if (name === 'harness-capabilities.patch') {
        const check=(file,args)=>spawnSync('git',['apply',...args,join(site,'patches',file)],{cwd:root,stdio:'ignore'}).status===0;
        if(check('harness-capabilities-legacy.patch',['--reverse','--check']) && check('harness-v8-wasmfx-lock.patch',['--check'])) {
          command('git',['apply',join(site,'patches/harness-v8-wasmfx-lock.patch')],{cwd:root,stdio:'inherit'});
          if(!applies(['--reverse','--check']))throw new Error('Upgraded V8 patch does not match its recorded complete state');
          continue;
        }
      }
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
      if (!applies(['--check'])) throw new Error(`Harness patch ${name} no longer matches. Update the recorded harness patches for the configured harness before building.`);
      command('git', ['apply', patch], { cwd: root, stdio: 'inherit' });
      console.log(`Applied recorded harness patch: ${name}`);
    }

  } finally {
    if(featureApplied)command('git',['apply',feature],{cwd:root});
  }
  if(!featureApplied) {
    if(!featureCheck(['--check']))throw new Error('Feature engine patch does not match the configured harness');
    command('git',['apply',feature],{cwd:root});
  }
  if(!featureCheck(['--reverse','--check']))throw new Error('Feature engine patch does not match its complete recorded state');
}

export function patchHarness(root) {
  const names=['harness-wazero-compile-freshness.patch','harness-v8-compile-freshness.patch'];
  const check=(name,args)=>spawnSync('git',['apply',...args,join(site,'patches',name)],{cwd:root,stdio:'ignore'}).status===0;
  const peeled=[];
  for(const name of [...names].reverse())if(check(name,['--reverse','--check'])) {
    command('git',['apply','--reverse',join(site,'patches',name)],{cwd:root});peeled.push(name);
  }
  let success=false;
  try {patchBase(root);success=true;}
  finally {
    for(const name of names)if(success || peeled.includes(name)) {
      if(check(name,['--reverse','--check']))continue;
      if(!check(name,['--check']))throw Error(name+' does not match');
      command('git',['apply',join(site,'patches',name)],{cwd:root});
    }
  }
}
