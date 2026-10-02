import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { access, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const site = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const exists = path => access(path).then(() => true, () => false);
export const json = async path => JSON.parse(await readFile(path, 'utf8'));
export const config = () => json(resolve(site, 'wasmbench.config.json'));
export function command(binary, args, options = {}) {
  try { return execFileSync(binary, args, { cwd: site, stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'inherit'], maxBuffer: 32 * 1024 * 1024, ...options }); }
  catch (error) {
    if (error.stdout?.length) process.stdout.write(error.stdout);
    throw new Error(`${binary} failed (${error.status ?? error.code ?? 'unknown status'})`);
  }
}
export async function harness() {
  const settings = await config();
  const root = resolve(site, process.env.WASMBENCH_ROOT || settings.root);
  const binary = process.env.WASMBENCH_BIN ? resolve(process.env.WASMBENCH_BIN) : 'go';
  return { root, settings, run: (...args) => command(binary, binary === 'go' ? ['run', './cmd/wasmbench', ...args] : args, { cwd: root }) };
}

/** Swap a prepared directory; restore the old one if installation fails. */
export async function installDirectory(staged, destination, backup = `${destination}.previous-${process.pid}`) {
  await mkdir(dirname(destination), { recursive: true });
  const hadPrevious = await exists(destination);
  if (hadPrevious) await rename(destination, backup);
  try { await rename(staged, destination); }
  catch (error) {
    if (hadPrevious) await rename(backup, destination);
    throw error;
  }
  return async restore => {
    if (restore) {
      await rm(destination, { recursive: true, force: true });
      if (hadPrevious) await rename(backup, destination);
    } else if (hadPrevious) await rm(backup, { recursive: true, force: true });
  };
}
export async function locked(fn, name = 'update') {
  const lock = resolve(site, `.wasmbench/${name}.lock`);
  await mkdir(dirname(lock), { recursive: true });
  let handle;
  try { handle = await open(lock, 'wx'); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Another update holds ${lock}. Remove it only after checking that the previous process has stopped.`);
    throw error;
  }
  try { await handle.writeFile(`${process.pid}\n`); return await fn(); }
  finally { await handle.close(); await rm(lock, { force: true }); }
}
export function compact(report) {
  const { trials, memoryTimelines, throughput, artifactAdmission, ...result } = report;
  return result;
}
