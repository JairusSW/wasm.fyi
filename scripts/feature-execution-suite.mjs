// Prepare only execution contracts for the existing wasm-bench steady scenario.
// The upstream semantic corpus is deliberately never part of this suite.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {site,digest} from './lib/wasmbench.mjs';
const root=join(site,'.wasmbench/feature-performance');
const all=JSON.parse(await readFile(join(root,'manifest.json')).catch(()=>{throw Error('Build the long feature contracts first: just features-performance-build')}));
const selected=all.filter(w=>!['compile-only','compile-and-instantiate'].includes(w.provenance.scope));
for(const w of selected) {
 w.artifact=join(root,w.artifact);
 if(digest(await readFile(w.artifact))!==w.sha256)throw Error('Stale execution artifact: '+w.id);
}
const output=join(site,'.wasmbench/feature-execution.json');
await mkdir(join(site,'.wasmbench'),{recursive:true});
await writeFile(output,JSON.stringify(selected,null,2)+'\n');
console.log(`${selected.length} long, single-feature execution contracts prepared in ${output}; use --scenarios steady --profile timing. Compilation, instantiation and upstream semantic tests are excluded from this scenario.`);
