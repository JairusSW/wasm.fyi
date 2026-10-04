import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { command, site } from './lib/wasmbench.mjs';
mkdirSync(join(site, '.wasmbench'), { recursive: true });
const generated = mkdtempSync(join(site, '.wasmbench/site-build-kit-'));
const result = spawnSync('pnpm', ['build'], {
  cwd: site, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  env: { ...process.env, WASMFYI_KIT_OUT_DIR: relative(site, generated) }
});
process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
if (result.error) throw result.error;
if (result.status !== 0 || /\[500\] GET|^\s+500 \//m.test((result.stdout || '') + (result.stderr || ''))) throw new Error('Site build or prerendering failed');
command(process.execPath, ['scripts/check-build.mjs'], { stdio: 'inherit' });
rmSync(generated, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
