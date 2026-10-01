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
  command(process.execPath, ['scripts/update-data.mjs', '--append', ...reports], { stdio: 'inherit' });
}, 'refresh');
