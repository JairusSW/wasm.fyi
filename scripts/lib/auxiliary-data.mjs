import {cloneCopy as cp} from './copy.mjs';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { exists, digest, site } from './wasmbench.mjs';
import { validateData } from './validate-data.mjs';
import { datasetFiles } from './snapshot-index.mjs';

export const threadEvidencePath = name => /^(?:[a-f0-9]{64}|(?:darwin-arm64|linux-x64)(?:-(?:optimizing-only|liftoff-only))?)\.json$/.test(name);
export function validateThreadEvidence(data) {
  assert([1,2].includes(data.schema),'Unknown worker evidence schema');
  if(data.collectorSource)assert.equal(digest(data.collectorSource),data.collectorSha256,'Worker collector source digest mismatch');
  assert.equal(data.feature,'threads');
  assert.equal(data.results.length,data.schema===2?64:32);
  if(data.schema===2)for(const mode of ['optimizing-only','liftoff-only']) {
    assert(data.variants?.[mode],'Missing worker tier identity');
    assert.equal(data.results.filter(r=>r.compilerMode===mode).length,32,'Incomplete worker tier cohort');
  }
  for(const result of data.results) {
    assert.equal(result.launches.length,3);
    for(const launch of result.launches) {
      assert.equal(launch.samples.length,3);
      for(const sample of launch.samples)assert(sample.verified && sample.elapsedNs>=0);
    }
  }
}

export async function stageAuxiliary(destination) {
  const releasePlan=join(site,'data/release-history/plan.json');
  if(await exists(releasePlan)){
    const plan=JSON.parse(await readFile(releasePlan));assert.equal(plan.schema,2);
    assert(plan.weeks.every(w=>new Date(w).getUTCDay()===3),'Release snapshots must be Wednesdays');
    assert(plan.pins.length===plan.weeks.length*14,'Incomplete release plan inventory');
    await mkdir(join(destination,'release-history'),{recursive:true});await cp(releasePlan,join(destination,'release-history/plan.json'));
  }
  const conformance=join(site,'data/conformance');
  if(await exists(join(conformance,'index.json'))){
    const index=JSON.parse(await readFile(join(conformance,'index.json')));
    assert.equal(index.schema,1);
    for(const report of index.reports){
      assert(/^[a-f0-9]{64}\.json$/.test(report.file),'Unsafe conformance evidence path');
      assert.equal(digest(await readFile(join(conformance,report.file))),report.sha256,'Changed conformance evidence');
    }
    await cp(conformance,join(destination,'conformance'),{recursive:true});
  }
  const preflightSource=join(site,'data/wasmer-preflight');
  if(await exists(preflightSource)) {
    const target=join(destination,'preflight/wasmer');await mkdir(target,{recursive:true});
    for(const name of await readdir(preflightSource)) {
      assert(/^(darwin-arm64|linux-x64)\.json$/.test(name),'Unsafe Wasmer preflight path');
      const data=JSON.parse(await readFile(join(preflightSource,name),'utf8'));
      assert.equal(data.schema,1);
      assert.equal(name,data.host.os+'-'+data.host.arch+'.json','Preflight host mismatch');
      assert(data.scope.includes('Correctness preflight only'),'Preflight must not claim benchmark measurements');
      assert.equal(digest(data.collector.source),data.collector.sourceSha256,'Native probe source digest mismatch');
      if(data.sdk.build){assert.equal(digest(data.sdk.buildManifestSource),data.sdk.buildManifestSha256,'SDK build manifest digest mismatch');assert.deepEqual(JSON.parse(data.sdk.buildManifestSource),data.sdk.build);assert.equal(data.sdk.build.librarySha256,data.sdk.librarySha256);}
      for(const sha of [data.artifact.sha256,data.sdk.librarySha256,data.collector.executableSha256,...Object.values(data.sdk.headers)])assert(/^[a-f0-9]{64}$/.test(sha),'Invalid preflight input digest');
      assert.deepEqual(data.configurations.map(c=>c.id),['wasmer-llvm','wasmer-singlepass']);
      for(const configuration of data.configurations) {
        assert(['ok','unavailable','failed','crashed'].includes(configuration.status));
        if(configuration.status==='ok'){assert.equal(configuration.result,'3');assert.equal(configuration.exitCode,0);assert(configuration.version);}
      }
      await cp(join(preflightSource,name),join(target,name));
    }
  }
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
      assert(threadEvidencePath(name),'Unsafe thread evidence path');
      if(/^[a-f0-9]{64}\.json$/.test(name)) assert.equal(digest(await readFile(join(source,name))),name.slice(0,-5),'Thread evidence filename digest mismatch');
      else {
        const pointer=JSON.parse(await readFile(join(source,name),'utf8'));
        assert(/^[a-f0-9]{64}\.json$/.test(pointer.evidence),'Unsafe thread evidence reference');
        const bytes=await readFile(join(source,pointer.evidence));assert.equal(digest(bytes),pointer.sha256);
        validateThreadEvidence(JSON.parse(bytes));
      }
      await cp(join(source,name),join(target,name));
    }
  }
}
