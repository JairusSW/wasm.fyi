import { parseArgs } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compact, command, config, digest, exists, installDirectory, json, locked, site } from './lib/wasmbench.mjs';
import { validateData } from './lib/validate-data.mjs';

const { values, positionals } = parseArgs({ options: { append: { type: 'boolean', default: false }, rebuild: { type: 'boolean', default: false } }, allowPositionals: true });
await locked(async () => {
  const work = join(site, '.wasmbench');
  await mkdir(work, { recursive: true });
  const temp = await mkdtemp(join(work, 'update-'));
  const destination = join(site, 'data/wasmbench');
  const staticDestination = join(site, 'static/wasmbench');
  const stagedData = join(temp, 'data');
  const prior = await exists(join(destination, 'index.json')) ? await readFile(join(destination, 'index.json')) : null;
  let finishData, finishStatic;
  const priorBuild = await exists(join(site, 'build'));
  if (priorBuild) await cp(join(site, 'build'), join(temp, 'build-backup'), { recursive: true });
  try {
    command(process.execPath, ['scripts/import-wasmbench.mjs', '--output', stagedData, ...(values.rebuild ? ['--rebuild'] : []), ...positionals], { stdio: 'inherit' });
    if (values.append && prior) {
      const previous = await validateData(destination);
      const incoming = await validateData(stagedData);
      const ids = new Set(incoming.reports.map(r => r.runId));
      const reports = [...incoming.reports, ...previous.reports.filter(r => !ids.has(r.runId))]
        .sort((a, b) => b.created.localeCompare(a.created)).slice(0, (await config()).retention || 12);
      for (const r of reports) if (!await exists(join(stagedData, r.evidence))) await cp(join(destination, r.evidence), join(stagedData, r.evidence));
      await writeFile(join(stagedData, 'index.json'), JSON.stringify({ schema: 1, reports }) + '\n');
    }
    if (await exists(join(destination, 'report-catalog.json'))) await cp(join(destination, 'report-catalog.json'), join(stagedData, 'report-catalog.json'));
    const index = await validateData(stagedData);
    await command(process.execPath, ['scripts/stage-data.mjs', stagedData, join(temp, 'static')], { stdio: 'inherit' });
    finishData = await installDirectory(stagedData, destination);
    finishStatic = await installDirectory(join(temp, 'static'), staticDestination);
    command('pnpm', ['check'], { stdio: 'inherit' });
    command('pnpm', ['test'], { stdio: 'inherit' });
    command(process.execPath, ['--test', 'scripts/workflow.test.mjs'], { stdio: 'inherit' });
    command(process.execPath, ['scripts/build-site.mjs'], { stdio: 'inherit' });
    const current = await readFile(join(destination, 'index.json'));
    await writeFile(join(work, 'update-summary.json'), JSON.stringify({ changed: !prior || digest(prior) !== digest(current),
      indexSha256: digest(current), runs: index.reports.map(r => ({ id: r.runId, created: r.created, sourceSha256: r.sourceReportSha256 || r.id, analysisReportSha256: r.id })) }, null, 2) + '\n');
    await finishStatic(false); finishStatic = null;
    await finishData(false); finishData = null;
    console.log('Website evidence update validated. UI layout and displayed fixture values are unchanged.');
  } catch (error) {
    if (finishStatic) await finishStatic(true);
    if (finishData) await finishData(true);
    await rm(join(site, 'build'), { recursive: true, force: true });
    if (priorBuild) await cp(join(temp, 'build-backup'), join(site, 'build'), { recursive: true });
    throw error;
  } finally { await rm(temp, { recursive: true, force: true }); }
});
