import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execute = promisify(execFile);

// Only an exact, full commit object can satisfy an immutable source pin.
// Tags, abbreviated IDs, trees and blobs still require the normal fetch path.
export async function hasPinnedCommit(repository, revision) {
  if (!/^[a-f0-9]{40}$/i.test(revision || '')) return false;
  try {
    const {stdout} = await execute('git', ['-C', repository, 'cat-file', '-t', revision], {timeout: 10000, maxBuffer: 1024});
    return stdout.trim() === 'commit';
  } catch {
    return false;
  }
}
