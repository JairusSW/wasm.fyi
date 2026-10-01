import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { site, installDirectory } from './lib/wasmbench.mjs';
import { validateData } from './lib/validate-data.mjs';
const source = resolve(process.argv[2] || `${site}/data/wasmbench`);
const destination = resolve(process.argv[3] || `${site}/static/wasmbench`);
const index = await validateData(source);
await mkdir(resolve(destination, '..'), { recursive: true });
const staged = await mkdtemp(join(resolve(destination, '..'), '.static-data-'));
try {
  for (const name of ['index.json', ...index.reports.map(r => r.evidence)]) await cp(join(source, name), join(staged, name));
  const finish = await installDirectory(staged, destination);
  await finish(false);
  console.log('Staged measured evidence at wasmbench/index.json; the original UI is unchanged.');
} finally { await rm(staged, { recursive: true, force: true }); }
