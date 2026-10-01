import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { command, site, locked } from './lib/wasmbench.mjs';
// Serialize collection independently; update-data owns the installation lock.
await locked(async () => {
  command(process.execPath, ['scripts/bench.mjs', 'collect'], { stdio: 'inherit' });
  const report = (await readFile(join(site, '.wasmbench/latest-report.txt'), 'utf8')).trim();
  const reports = [report];
  if (!process.argv.includes('--local')) {
    command(process.execPath, ['scripts/hub.mjs', 'collect'], { stdio: 'inherit' });
    reports.push((await readFile(join(site, '.wasmbench/latest-hub-report.txt'), 'utf8')).trim());
  }
  if (!process.env.WASMBENCH_SKIP_FEATURES) {
    const featureEnv = { ...process.env, WASMBENCH_SUITE: 'corpora/features/manifest.json', WASMBENCH_VALIDATION_PROFILE: 'all', WASMBENCH_WARMUP: '0', WASMBENCH_RECORD_FAILURES: '1' };
    command(process.execPath, ['scripts/bench.mjs','build'], { stdio:'inherit',env:featureEnv });
    command(process.execPath, ['scripts/feature-corpus.mjs', 'check'], { stdio: 'inherit', env: featureEnv });
    command(process.execPath, ['scripts/bench.mjs', 'collect'], { stdio: 'inherit', env: featureEnv });
    reports.push((await readFile(join(site, '.wasmbench/latest-report.txt'), 'utf8')).trim());
    if (!process.argv.includes('--local')) {
      command(process.execPath, ['scripts/hub.mjs', 'collect'], { stdio: 'inherit', env: featureEnv });
      reports.push((await readFile(join(site, '.wasmbench/latest-hub-report.txt'), 'utf8')).trim());
    }
  }
  if (!process.env.WASMBENCH_SKIP_FEATURES) {
    command(process.execPath, ['scripts/thread-workers.mjs'], { stdio: 'inherit' });
    if (!process.argv.includes('--local')) command(process.execPath, ['scripts/hub.mjs','threads'], { stdio: 'inherit' });
  }
  command(process.execPath, ['scripts/update-data.mjs', '--append', '--rebuild', ...reports], { stdio: 'inherit' });
}, 'refresh');
