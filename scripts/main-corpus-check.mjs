import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { config, site, digest } from './lib/wasmbench.mjs';
import { parseCorpusJSON } from './lib/corpus.mjs';
import { applicationWorkloads } from './lib/application-manifest.mjs';
import { assertMainCorpusContract } from './lib/main-corpus-contract.mjs';

const settings = await config();
const upstream = parseCorpusJSON(await readFile(resolve(site, settings.corpus.buildManifest), 'utf8'));
if (upstream.length !== settings.corpus.ids.length
    || new Set(upstream.map(w => w.id.split('/')[1])).size !== settings.corpus.ids.length
    || settings.corpus.ids.some(id => !upstream.some(w => w.id.split('/')[1] === id))) {
  throw new Error('Non-WASI audit requires the complete source-built main corpus');
}
const workloads = [...upstream, ...await applicationWorkloads(settings.corpus.applications)];
const outcomes = [];
for (const w of workloads) {
  const bytes = await readFile(w.artifact);
  if (digest(bytes) !== w.sha256) throw new Error(`Artifact digest mismatch: ${w.id}`);
  outcomes.push({ id: w.id, sha256: w.sha256, imports: assertMainCorpusContract(w, bytes), status: 'verified' });
}
await mkdir(join(site, '.wasmbench'), { recursive: true });
await writeFile(join(site, '.wasmbench/main-corpus-check.json'), JSON.stringify({
  schema: 1, policy: 'Core ABI only; no WASI or host I/O imports. Only existing AssemblyScript fatal assertion imports are permitted. Feature probes are outside this audit.',
  outcomes
}, null, 2) + '\n');
console.log(`Main corpus: ${outcomes.length} core contracts verified; zero WASI imports.`);
