import {cloneCopy as cp} from './lib/copy.mjs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { site, exists, installDirectory } from './lib/wasmbench.mjs';
import { validateData } from './lib/validate-data.mjs';
import { stageAuxiliary } from './lib/auxiliary-data.mjs';
import { featureSupport } from './lib/feature-support.mjs';
import { datasetFiles } from './lib/snapshot-index.mjs';
const source = resolve(process.argv[2] || `${site}/data/wasmbench`);
const destination = resolve(process.argv[3] || `${site}/static/wasmbench`);
const index = await validateData(source);
await mkdir(resolve(destination, '..'), { recursive: true });
const staged = await mkdtemp(join(resolve(destination, '..'), '.static-data-'));
try {
  for (const name of datasetFiles(index)) await cp(join(source, name), join(staged, name));
  await writeFile(join(staged, 'feature-support.json'), JSON.stringify(await featureSupport(source, index.reports)) + '\n');
  await cp(join(site,'corpora/catalog.json'),join(staged,'corpus-catalog.json'));
  await stageAuxiliary(staged);
  if(await exists(join(site,'data/benchmark-runs')))await cp(join(site,'data/benchmark-runs'),join(staged,'runs'),{recursive:true});
  const codeInspection=join(destination,'code-inspection');
  if(await exists(codeInspection))
    await cp(codeInspection,join(staged,'code-inspection'),{recursive:true});
  const finish = await installDirectory(staged, destination);
  await finish(false);
  console.log('Staged measured evidence at wasmbench/index.json; the original UI is unchanged.');
} finally { await rm(staged, { recursive: true, force: true }); }
