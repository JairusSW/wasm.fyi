import { command, harness } from './lib/wasmbench.mjs';
const gh = args => command('gh', args).toString().trim();
const repository = gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
const action = process.argv[2];
if (action === 'status') {
  console.log(gh(['api', `repos/${repository}/actions/runners`, '--jq', '{count: .total_count, runners: [.runners[] | {name,status,labels: [.labels[].name]}]}']));
  console.log(gh(['variable', 'list']));
} else if (action === 'disable') gh(['variable', 'set', 'WASMBENCH_AUTOMATION_ENABLED', '--body', 'false']);
else if (action === 'enable' || action === 'run') {
  const pool = JSON.parse(gh(['api', `repos/${repository}/actions/runners`]));
  if (!pool.runners.some(r => r.status === 'online' && r.labels.some(l => l.name === 'wasm-bench'))) {
    throw new Error('Register an online self-hosted runner with the wasm-bench label before enabling collection. See docs/updating.md.');
  }
  if (action === 'enable') {
    // Fail before enabling daily automation if Hub is unavailable.
    command(process.execPath, ['scripts/hub.mjs', 'doctor'], { stdio: 'inherit' });
    const { root, settings } = await harness();
    gh(['variable', 'set', 'WASMBENCH_ROOT', '--body', root]);
    if (settings.collection.runtimes.includes('wago')) {
      const { resolve } = await import('node:path');
      const { site } = await import('./lib/wasmbench.mjs');
      gh(['variable', 'set', 'WAGO_SOURCE', '--body', resolve(site, process.env.WAGO_SOURCE || settings.collection.wagoSource)]);
    }
    gh(['variable', 'set', 'WASMBENCH_AUTOMATION_ENABLED', '--body', 'true']);
    console.log('Daily collection enabled for the configured measurement runner.');
  } else {
    const enabled = gh(['variable', 'get', 'WASMBENCH_AUTOMATION_ENABLED']);
    if (enabled !== 'true') throw new Error('Enable the configured measurement runner with just automation-enable first.');
    gh(['workflow', 'run', 'update-benchmarks.yml']);
    console.log('Benchmark refresh workflow dispatched.');
  }
} else throw new Error('Usage: node scripts/automation.mjs status|enable|disable|run');
