import {cloneCopy as cp} from './lib/copy.mjs';
import { parseArgs } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { datasetFiles, retainReports } from './lib/snapshot-index.mjs';
import { compact, command, config, digest, exists, installDirectory, json, locked, site } from './lib/wasmbench.mjs';
import { validateData } from './lib/validate-data.mjs';
import { stageHistoryBaseline } from './lib/history-baseline.mjs';
import { writeIndex } from './lib/snapshot-index.mjs';

const { values, positionals } = parseArgs({ options: { dataset: {type:'string'}, append: { type: 'boolean', default: false }, rebuild: { type: 'boolean', default: false } }, allowPositionals: true });
await locked(async () => {
  const work = join(site, '.wasmbench');
  await mkdir(work, { recursive: true });
  const temp = await mkdtemp(join(work, 'update-'));
  const destination = join(site, 'data/wasmbench');
  const staticDestination = join(site, 'static/wasmbench');
  const stagedData = join(temp, 'data');
  const prior = await exists(join(destination, 'index.json')) ? await readFile(join(destination, 'index.json')) : null;
  let finishData, finishStatic;
  const finishHistories=[];
  const priorBuild = await exists(join(site, 'build'));
  if (priorBuild) await cp(join(site, 'build'), join(temp, 'build-backup'), { recursive: true });
  try {
    if(values.dataset) {
      if(positionals.length || values.rebuild)throw new Error('--dataset cannot be combined with report paths or --rebuild');
      const source=resolve(values.dataset),inventory=await validateData(source);
      await mkdir(stagedData,{recursive:true});
      for(const name of datasetFiles(inventory))await cp(join(source,name),join(stagedData,name));
    } else {
      command(process.execPath, ['scripts/import-wasmbench.mjs', '--output', stagedData, ...(values.rebuild ? ['--rebuild'] : []), ...positionals], { stdio: 'inherit' });
      await validateData(stagedData);
      const cache=join(temp,'verified-inputs');await cp(stagedData,cache,{recursive:true});
      const finish=await installDirectory(cache,join(work,'verified-inputs'));await finish(false);
    }
    if (values.append && prior) {
      const previous = await validateData(destination);
      const incoming = await validateData(stagedData);
      const ids = new Set(incoming.reports.map(r => r.runId));
      const reports = retainReports([...incoming.reports, ...previous.reports.filter(r => !ids.has(r.runId))], (await config()).retention || 12);
      for (const r of reports) if (!await exists(join(stagedData, r.evidence))) await cp(join(destination, r.evidence), join(stagedData, r.evidence));
      await writeIndex(stagedData, reports);
    }
    if (await exists(join(destination, 'report-catalog.json'))) await cp(join(destination, 'report-catalog.json'), join(stagedData, 'report-catalog.json'));
    const index = await validateData(stagedData);
    await command(process.execPath, ['scripts/stage-data.mjs', stagedData, join(temp, 'static')], { stdio: 'inherit' });
    finishData = await installDirectory(stagedData, destination);
    finishStatic = await installDirectory(join(temp, 'static'), staticDestination, join(temp,'static-backup'));
    const runtimeIds=(await config()).collection.runtimes.filter(id=>id!=='wago');
    for(const name of ['history','history-hub']){
      const source=join(site,'data',name),staged=join(temp,name);
      if(await stageHistoryBaseline(source,destination,index.reports,staged,runtimeIds))finishHistories.push(await installDirectory(staged,source));
    }
    command('pnpm', ['check'], { stdio: 'inherit' });
    command('pnpm', ['test'], { stdio: 'inherit' });
    command(process.execPath, ['--test', 'scripts/workflow.test.mjs', 'scripts/v8-preflight.test.mjs'], { stdio: 'inherit' });
    command(process.execPath, ['scripts/build-site.mjs'], { stdio: 'inherit' });
    const current = await readFile(join(destination, 'index.json'));
    await writeFile(join(work, 'update-summary.json'), JSON.stringify({ changed: !prior || digest(prior) !== digest(current),
      indexSha256: digest(current), runs: index.reports.map(r => ({ id: r.runId, created: r.created, sourceSha256: r.sourceReportSha256 || r.id, analysisReportSha256: r.id })) }, null, 2) + '\n');
    for(const finish of finishHistories)await finish(false);
    finishHistories.length=0;
    await finishStatic(false); finishStatic = null;
    await finishData(false); finishData = null;
    console.log('Website evidence update validated. Measured views and raw evidence are current; UI layout is preserved.');
  } catch (error) {
    for(const finish of finishHistories.reverse())await finish(true);
    if (finishStatic) await finishStatic(true);
    if (finishData) await finishData(true);
    await rm(join(site, 'build'), { recursive: true, force: true });
    if (priorBuild) await cp(join(temp, 'build-backup'), join(site, 'build'), { recursive: true });
    throw error;
  } finally { await rm(temp, { recursive: true, force: true }); }
});
