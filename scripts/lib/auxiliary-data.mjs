import assert from 'node:assert/strict';
import { mkdir, cp, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { exists, digest, site } from './wasmbench.mjs';
import { validateData } from './validate-data.mjs';
import { datasetFiles } from './snapshot-index.mjs';

export async function stageAuxiliary(destination) {
  for (const [sourceName,targetName] of [['history','history'],['history-hub','history-hub']]) {
    const source=join(site,'data',sourceName);
    if (!await exists(join(source,'index.json'))) continue;
    const index=await validateData(source);
    const weekly=JSON.parse(await readFile(join(source,'weekly.json'),'utf8'));
    const ids=new Set(index.reports.map(r=>r.runId));
    assert(weekly.results.length===weekly.weeks.length,'Incomplete weekly inventory');
    for(const week of weekly.results) {
      assert(week.status==='measured' && ids.has(week.runId),'Missing historical measured evidence');
      const report=index.reports.find(r=>r.runId===week.runId);
      assert.equal(report.created,week.collectedAt,'Backdated historical evidence');
      assert.equal(report.sourceReportSha256,week.reportSha256,'Historical source digest mismatch');
      assert(report.runtimes.some(r=>r.id==='wago' && r.description.runtime_version.startsWith(week.revision+'/')),'Historical revision mismatch');
    }
    // Keep the comparison baseline with history; daily retention cannot remove it.
    assert(weekly.baseline && index.reports.some(r=>r.id===weekly.baseline.report && r.evidenceSha256===weekly.baseline.evidenceSha256),'Missing pinned historical comparison baseline');
    const target=join(destination,targetName);await mkdir(target,{recursive:true});
    const indexed=JSON.parse(await readFile(join(source,'index.json'),'utf8'));
    for(const name of [...datasetFiles(indexed),'weekly.json'])await cp(join(source,name),join(target,name));
  }
  const source=join(site,'data/threads');
  if(await exists(source)) {
    const target=join(destination,'threads');await mkdir(target,{recursive:true});
    for(const name of await readdir(source)) {
      assert(/^(?:[a-f0-9]{64}|(?:darwin-arm64|linux-x64))\.json$/.test(name),'Unsafe thread evidence path');
      if(/^[a-f0-9]{64}\.json$/.test(name)) assert.equal(digest(await readFile(join(source,name))),name.slice(0,-5),'Thread evidence filename digest mismatch');
      else {
        const pointer=JSON.parse(await readFile(join(source,name),'utf8'));
        assert(/^[a-f0-9]{64}\.json$/.test(pointer.evidence),'Unsafe thread evidence reference');
        const bytes=await readFile(join(source,pointer.evidence));assert.equal(digest(bytes),pointer.sha256);
        const data=JSON.parse(bytes);assert.equal(data.feature,'threads');assert.equal(data.results.length,32);
        for(const result of data.results) {assert.equal(result.launches.length,3);for(const launch of result.launches){assert.equal(launch.samples.length,3);for(const sample of launch.samples)assert(sample.verified && sample.elapsedNs>=0);}}
      }
      await cp(join(source,name),join(target,name));
    }
  }
}
