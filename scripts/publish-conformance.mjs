import {mkdir,readFile,readdir,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {verifyConformanceArchive,conformanceSummary} from './lib/conformance-archive.mjs';
import {site} from './lib/wasmbench.mjs';
import {processLock} from './lib/benchmark-lock.mjs';
import {durableConformanceFile,readConformanceIndex,installConformanceCopy} from './lib/conformance-publication.mjs';
import {exportConformanceArchive,publishConformanceExport} from './lib/conformance-api.mjs';
import {publicationURL} from './lib/api-publish.mjs';
import assert from 'node:assert/strict';
const apiURL=process.env.WASMFYI_CONFORMANCE_API_URL;
if(apiURL){publicationURL(apiURL);assert(typeof process.env.WASMFYI_ADMIN_TOKEN==='string'&&process.env.WASMFYI_ADMIN_TOKEN.length>=32,'WASMFYI_ADMIN_TOKEN must contain at least 32 characters')}
const supplied=process.argv.slice(2);
const directories=supplied.length?supplied.map(p=>resolve(p)):(await readdir(join(site,'.wasmbench/conformance'))).map(p=>join(site,'.wasmbench/conformance',p));
await processLock(join(site,'.wasmbench/conformance-publish.lock'),async()=>{
if(apiURL){
  const cache=join(site,'.wasmbench/conformance-api');await mkdir(cache,{recursive:true});
  for(const directory of directories){
    const bytes=await readFile(join(directory,'report.json')),receipt=await readFile(join(directory,'sha256'));
    const {sha256,receiptSha256}=verifyConformanceArchive(bytes,receipt);
    // Cache identities include the exact checksum receipt representation.
    const output=join(cache,'v2-'+sha256+'-'+receiptSha256);
    try{const info=await lstat(output);assert(info.isDirectory()&&!info.isSymbolicLink(),'Invalid conformance export directory')}
    catch(error){if(error.code!=='ENOENT')throw error;await exportConformanceArchive({bytes,receipt,directory:output})}
    const revision=await publishConformanceExport({directory:output,url:apiURL});
    console.log('Published conformance source '+sha256+' in revision '+revision);
  }
  return;
}
const destination=join(site,'data/conformance');await mkdir(destination,{recursive:true});
const previous=await readConformanceIndex(join(destination,'index.json'));
for(const directory of directories){
  const bytes=await readFile(join(directory,'report.json')),receipt=await readFile(join(directory,'sha256'));
  const {report,sha256:sha}=verifyConformanceArchive(bytes,receipt);
  const file=sha+'.json';await durableConformanceFile(join(destination,file),bytes,{immutable:true});
  previous.reports=previous.reports.filter(r=>r.sha256!==sha);
  previous.reports.push(conformanceSummary(report,sha));
}
previous.policy='Published-release conformance evidence; whole WAST files, WASI runner cases and plugin leaf tests have distinct units. Representative performance corpora never enter these totals. Failed, skipped and uncollected runners are explicit.';
const staticRoot=join(site,'static/wasmbench/conformance');await mkdir(staticRoot,{recursive:true});
for(const entry of previous.reports)await installConformanceCopy(join(destination,entry.file),join(staticRoot,entry.file),entry.sha256);
await durableConformanceFile(join(destination,'index.json'),Buffer.from(JSON.stringify(previous)+'\n'));
await durableConformanceFile(join(staticRoot,'index.json'),Buffer.from(JSON.stringify(previous)+'\n'));
console.log('Published checksum-verified upstream suite evidence');
});
