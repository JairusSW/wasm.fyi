import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { digest } from './wasmbench.mjs';

// Verify the original archive before regenerating derived reports on a different
// architecture. Raw bundle semantics are independently checked by the harness.
export async function verifySeal(root) {
  const checksums = JSON.parse(await readFile(join(root, 'checksums.json'), 'utf8'));
  assert(checksums && typeof checksums === 'object' && !Array.isArray(checksums), 'Invalid seal');
  const files = [];
  async function walk(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = prefix + entry.name;
      assert(!entry.isSymbolicLink(), 'Sealed reports must not contain symlinks');
      if (entry.isDirectory()) await walk(join(directory, entry.name), name + '/');
      else { assert(entry.isFile(), 'Unexpected archive entry'); files.push(name); }
    }
  }
  await walk(root);
  assert.deepEqual(files.filter(path => !['checksums.json','.DS_Store'].includes(path)).sort(), Object.keys(checksums).filter(path => path !== '.DS_Store').sort(), 'Seal does not cover the exact archive');
  for (const [path, expected] of Object.entries(checksums)) {
    assert(!path.startsWith('/') && !path.split('/').some(part => !part || part === '.' || part === '..') && !path.includes('\\'), 'Unsafe seal path');
    assert(/^[a-f0-9]{64}$/.test(expected), 'Invalid seal digest');
    if(path === '.DS_Store') continue; // Mutable Finder metadata, including legacy seals.
    assert.equal(digest(await readFile(join(root, path))), expected, `Archive checksum mismatch: ${path}`);
  }
  assert(checksums['data.json'], 'Report seal must cover data.json');
  return checksums;
}
