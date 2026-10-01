import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, link, mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { command } from './wasmbench.mjs';

export async function fileDigest(path) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}

// Deduplicate only the owned transport copy. Original experiment files remain
// untouched; tar restores every pathname, including identical hard-linked files.
export async function packEvidence(source, archive, complete = false) {
  source = resolve(source); archive = resolve(archive);
  if (archive.startsWith(source + '/')) throw new Error('Archive must be outside its source');
  const staging = await mkdtemp(join(dirname(archive), '.evidence-transport-'));
  const content = new Map();
  let files = 0;
  try {
    async function walk(relative = '') {
      await mkdir(join(staging, relative), { recursive: true });
      for (const entry of await readdir(join(source, relative), { withFileTypes: true })) {
        const path = relative ? relative + '/' + entry.name : entry.name;
        // Completed reports already contain all sealed passes. Failed runs keep
        // their original pass directories for diagnosis.
        if (/^history\/(?:harness-[^/]+|revisions)$/.test(path)) continue;
        if (complete && /^experiments\/[^/]+\/(timing|memory|code)-[^/]+$/.test(path)) continue;
        if (entry.isDirectory()) await walk(path);
        else {
          if (!entry.isFile()) throw new Error('Evidence transport accepts regular files only');
          const original = join(source, path), target = join(staging, path);
          const sha = await fileDigest(original);
          const key = `${sha}:${(await stat(original)).mode}`;
          if (content.has(key)) await link(content.get(key), target);
          else {
            await cp(original, target, { preserveTimestamps: true });
            content.set(key, target);
          }
          files++;
        }
      }
    }
    await walk();
    command('tar', ['-cJf', archive, '-C', staging, '.'], {
      env: { ...process.env, XZ_OPT: '-T2 -9' }, timeout: 15 * 60 * 1000
    });
    return { sha256: await fileDigest(archive), bytes: (await stat(archive)).size, files, uniqueFiles: content.size };
  } finally { await rm(staging, { recursive: true, force: true }); }
}
