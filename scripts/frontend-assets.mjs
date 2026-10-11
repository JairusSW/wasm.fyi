import { mkdir, copyFile, cp, writeFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { renderDiscovery } from './lib/discovery.mjs';

// A frontend release contains documentation, not a stale copy of live data.
const output = resolve('.wasmfyi/frontend-assets');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await copyFile(resolve('static/favicon.svg'), resolve(output, 'favicon.svg'));
await cp(resolve('static/brand'), resolve(output, 'brand'), { recursive: true });
await cp(resolve('schemas'), resolve(output, 'schemas'), { recursive: true, filter: source => !source.endsWith('.ts') });
await copyFile(resolve('API.md'), resolve(output, 'reference.md'));
for (const [path, contents] of renderDiscovery({ base: process.env.BASE_PATH || '' })) {
  const destination = resolve(output, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, contents);
}
