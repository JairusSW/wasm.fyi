import { spawnSync } from 'node:child_process';
import { command, site } from './lib/wasmbench.mjs';
command(process.execPath, ['scripts/stage-data.mjs'], { stdio: 'inherit' });
const result = spawnSync('pnpm', ['build'], { cwd: site, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
if (result.error) throw result.error;
if (result.status !== 0 || /\[500\] GET|^\s+500 \//m.test((result.stdout || '') + (result.stderr || ''))) throw new Error('Site build or prerendering failed');
command(process.execPath, ['scripts/check-build.mjs'], { stdio: 'inherit' });
