import {mkdir,readFile,writeFile,cp,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {site,digest} from './lib/wasmbench.mjs';
const supplied=process.argv.slice(2);
const directories=supplied.length?supplied.map(p=>resolve(p)):(await readdir(join(site,'.wasmbench/conformance'))).map(p=>join(site,'.wasmbench/conformance',p));
const destination=join(site,'data/conformance');await mkdir(destination,{recursive:true});
const previous=await readFile(join(destination,'index.json'),'utf8').then(JSON.parse,()=>({schema:1,reports:[]}));
for(const directory of directories){
  const bytes=await readFile(join(directory,'report.json')),sha=digest(bytes);
  assert.equal((await readFile(join(directory,'sha256'),'utf8')).trim(),sha,'Changed conformance archive');
  const report=JSON.parse(bytes);assert.equal(report.schema,1);assert.ok(report.host && report.created && report.lanes.length);
  for(const lane of report.lanes){
    if(lane.kind==='wast'){
      assert.equal(lane.results.length,lane.suite.inventory.length,'Missing WAST outcome');
      assert.equal(new Set(lane.results.map(r=>r.path)).size,lane.results.length,'Duplicate WAST outcome');
      for(const file of lane.suite.inventory)assert.equal(lane.results.find(r=>r.path===file.path)?.sha256,file.sha256);
      assert.ok(/^v[0-9]/.test(lane.engine.tag));assert.ok(/^[a-f0-9]{64}$/.test(lane.engine.sha256));
    }
  }
  const file=sha+'.json';await writeFile(join(destination,file),bytes);
  previous.reports=previous.reports.filter(r=>r.sha256!==sha);
  previous.reports.push({file,sha256:sha,created:report.created,host:report.host,lanes:report.lanes.map(l=>({id:l.id,unit:l.unit,status:l.status || (Object.entries(l.totals).some(([k,n])=>['failed','crashed','runner-error'].includes(k) && n>0)?'failed':'passed'),totals:l.totals || (l.upstream && Object.fromEntries(['passed','failed','skipped','xfailed','xpassed'].map(k=>[k,l.upstream.results.reduce((n,g)=>n+(g[k] || 0),0)]))),engine:l.engine,suite:l.suite && {repository:l.suite.repository,revision:l.suite.revision,label:l.suite.label},reason:l.reason}))});
}
previous.policy='Published-release conformance evidence; whole WAST files, WASI runner cases and plugin leaf tests have distinct units. Representative performance corpora never enter these totals. Failed, skipped and uncollected runners are explicit.';
await writeFile(join(destination,'index.json'),JSON.stringify(previous)+'\n');
await mkdir(join(site,'static/wasmbench/conformance'),{recursive:true});
await cp(destination,join(site,'static/wasmbench/conformance'),{recursive:true});
console.log('Published checksum-verified upstream suite evidence');
