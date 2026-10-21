import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {site,digest} from './lib/wasmbench.mjs';
import {proposalSuites,prepareProposalSuite,runProposalSuite} from './lib/proposal-upstream.mjs';
const action=process.argv[2]||'prepare';
const selected=process.argv.find(a=>a.startsWith('--suite='))?.slice(8).split(',');
if(selected?.some(id=>!proposalSuites.some(s=>s.id===id)))throw Error('Unknown upstream suite');
const inventory=join(site,'corpora/features/upstream/full-suite-index.json');
if(action==='prepare') {
 const suites=[];
 for(const pin of proposalSuites)suites.push(await prepareProposalSuite(pin));
 await writeFile(inventory,JSON.stringify({schema:1,policy:'Complete pinned WAST and mjsunit/wasm file inventories; no positive-only selection or case-count limits. Rust backend matrices and V8 variant/status matrices are separate qualification.',suites},null,2)+'\n');
 console.log(suites.map(s=>`${s.id}: ${s.files.length} files`).join('\n'));
} else if(action==='check') {
 const index=JSON.parse(await readFile(inventory));
 const out=resolve(process.argv.find(a=>a.startsWith('--out='))?.slice(6)||join(site,'.wasmbench/proposal-coverage/full-suite-reports'));
 await mkdir(out,{recursive:true});
 let failed=false;
 for(const suite of index.suites.filter(s=>!selected||selected.includes(s.id))) {
  const expected=proposalSuites.find(s=>s.id===suite.id);
  if(!expected||suite.revision!==expected.revision||suite.archiveSha256!==expected.archiveSha256)throw Error('Changed suite pin');
  const fresh=await prepareProposalSuite(expected);
  if(JSON.stringify(fresh)!==JSON.stringify(suite))throw Error('Changed full-suite inventory: '+suite.id);
  const path=join(out,suite.id+'.json'),result=await runProposalSuite(suite,{out:path});
  const totals=Object.fromEntries(['passed','failed','crashed','runner-error'].map(s=>[s,result.results.filter(r=>r.status===s).length]));
  await writeFile(path,JSON.stringify({...result,created:new Date().toISOString(),timing:false,inventorySha256:digest(await readFile(inventory)),totals},null,2)+'\n');
  console.log(suite.id,totals);failed ||= totals.passed!==suite.files.length;
 }
 if(failed)process.exitCode=1;
} else throw Error('Usage: proposal-upstream.mjs prepare|check [--suite=spec,wasmtime,component,v8-15.2.20] [--out=directory]');
