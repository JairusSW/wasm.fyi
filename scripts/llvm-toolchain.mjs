// Isolated Linux prerequisite for the pinned Wasmer LLVM SDK.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir, platform, arch } from 'node:os';
import { join } from 'node:path';
import { command, exists, locked } from './lib/wasmbench.mjs';

await locked(async () => {
  if (platform() !== 'linux' || arch() !== 'x64') throw new Error('This pinned LLVM distribution requires Linux x64');
  const version = '22.1.8';
  const sha256 = 'df0e1ecf16caf3489a272a5eea4eec9b0d82878f6477fa309504f918a0006384';
  const name = `LLVM-${version}-Linux-X64.tar.xz`;
  const url = `https://github.com/llvm/llvm-project/releases/download/llvmorg-${version}/${name}`;
  const root = join(homedir(), '.local/share/wasm-fyi/toolchains');
  const destination = join(root, 'llvm-22');
  const manifest = { schema: 1, version, url, sha256 };
  const marker = join(destination, 'wasm-fyi-build.json');
  if (await exists(destination)) {
    if (!await exists(marker) || JSON.stringify(JSON.parse(await readFile(marker))) !== JSON.stringify(manifest)) throw new Error('Existing LLVM prefix is not this managed distribution');
    if (command(join(destination, 'bin/llvm-config'), ['--version']).toString().trim() !== version) throw new Error('Installed LLVM version differs');
    console.log(`Verified managed LLVM ${version}: ${destination}`);
    return;
  }
  await mkdir(root, { recursive: true });
  const archive = join(root, name);
  if (!await exists(archive)) {
    const partial = archive + '.partial';
    command('curl', ['--fail', '--location', '--retry', '3', '--output', partial, url], { stdio: 'inherit', timeout: 30 * 60_000 });
    await rename(partial, archive);
  }
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  if (hash.digest('hex') !== sha256) throw new Error('LLVM archive SHA256 differs from the official release asset digest');
  const staged = destination + '.staged-' + process.pid;
  await mkdir(staged);
  try {
    command('tar', ['-xJf', archive, '--strip-components=1', '-C', staged], { stdio: 'inherit', timeout: 30 * 60_000 });
    if (command(join(staged, 'bin/llvm-config'), ['--version']).toString().trim() !== version) throw new Error('Extracted LLVM version differs');
    await writeFile(join(staged, 'wasm-fyi-build.json'), JSON.stringify(manifest, null, 2) + '\n');
    await rename(staged, destination);
  } finally { await rm(staged, { recursive: true, force: true }); }
  console.log(`Installed verified LLVM ${version}: ${destination}`);
}, 'llvm-toolchain');
