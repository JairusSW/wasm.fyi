// Run after corpus generation, not during timing captures. No visitor can upload.
import {readFile} from 'node:fs/promises';
import {resolve,dirname,basename} from 'node:path';
import {parseCorpusJSON} from './lib/corpus.mjs';
import {workloadContract} from './lib/workload-contract.mjs';
import {digest} from './lib/wasmbench.mjs';
import {artifactOrigin} from './local/artifacts.mjs';
const args=process.argv.slice(2),get=name=>args.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
const origin=artifactOrigin(get('origin')||'https://wasm.fyi'),manifests=args.filter(a=>!a.startsWith('--'));
if(!manifests.length)throw Error('Usage: node scripts/publish-artifacts.mjs [--origin=https://wasm.fyi] [--token-file=FILE] MANIFEST...');
const token=get('token-file')?(await readFile(get('token-file'),'utf8')).trim():process.env.WASMFYI_ADMIN_TOKEN;
if(!token||token.length<32)throw Error('Set WASMFYI_ADMIN_TOKEN or --token-file (publishing token stays off the command line)');
const headers={Authorization:'Bearer '+token,...(['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname)?{'X-Real-IP':'127.0.0.1'}:{})};
async function request(path,init){const response=await fetch(origin+path,{...init,headers:{...headers,...init?.headers},redirect:'error',signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error('Artifact publication HTTP '+response.status+': '+(await response.text()).slice(0,512));await response.arrayBuffer()}
const uploaded=new Set();let count=0;
for(const file of manifests){
 const rows=parseCorpusJSON(await readFile(file,'utf8'));if(!Array.isArray(rows))throw Error('Manifest must contain workload contracts: '+file);
 for(const w of rows){
  const path=resolve(dirname(resolve(file)),w.artifact),bytes=await readFile(path),hash=digest(bytes);
  if(hash!==w.sha256)throw Error('Manifest artifact SHA-256 mismatch: '+w.id);
  if(!uploaded.has(hash)){await request('/api/artifacts/'+hash+'.wasm',{method:'PUT',body:bytes,headers:{'Content-Type':'application/wasm'}});uploaded.add(hash)}
  // Filesystem locations have no place in the public catalogue. Contracts and
  // provenance are otherwise retained, including exact integer oracle values.
  const workload={...w,artifact:basename(w.artifact),...(w.source?{source:basename(w.source)}:{})};
  if(workload.provenance?.recipe){const recipe={...workload.provenance.recipe};for(const key of ['source','artifact'])if(typeof recipe[key]==='string')recipe[key]=basename(recipe[key]);workload.provenance={...workload.provenance,recipe}}
  await request('/api/artifacts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workload,contractSha256:workloadContract(workload)})});count++;
 }
}
console.log(`Published ${count} workload contracts / ${uploaded.size} distinct Wasm files; retention 90 days from publication.`);
