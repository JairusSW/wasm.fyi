import { resolve } from 'node:path';
import { site } from './lib/wasmbench.mjs';
import { validateData } from './lib/validate-data.mjs';
const index = await validateData(resolve(process.argv[2] || `${site}/data/wasmbench`));
console.log(`Validated ${index.reports.length} snapshots and all referenced evidence digests.`);
