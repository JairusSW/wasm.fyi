import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {relative,join} from 'node:path';
import {site,digest} from './wasmbench.mjs';
import {datasetFiles} from './snapshot-index.mjs';
const exec=promisify(execFile);
// Keep long backfills within Pages' size limit. Only committed, byte-identical
// evidence may be served from immutable source URLs; unpublished data stays local.
export async function stageHistoryArchive(source,destination,index){
 if(process.env.WASMBENCH_THIN_HISTORY!=='1')return false;
 const root=relative(site,source);
 const revision=(await exec('git',['rev-parse','HEAD'],{cwd:site})).stdout.trim();
 const origin=(await exec('git',['remote','get-url','origin'],{cwd:site})).stdout.trim();
 const repository=origin.match(/github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/)?.[1];
 if(!repository)return false;
 const tree=(await exec('git',['ls-tree','-r','-z',revision,'--',root],{cwd:site,maxBuffer:16*1024*1024})).stdout;
 const blobs=new Map(tree.split('\0').filter(Boolean).map(row=>{const [metadata,path]=row.split('\t');return [path,metadata.split(' ')[2]];}));
 const files=[...datasetFiles(index),'weekly.json'];
 for(const name of files){
  const bytes=await readFile(join(source,name));
  const blob=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  if(blobs.get(root+'/'+name)!==blob)return false;
 }
 const url=name=>`https://raw.githubusercontent.com/${repository}/${revision}/${root}/${name}`;
 const original=await readFile(join(source,'index.json'));
 const entries=new Map(JSON.parse(original).reports.map(r=>[r.id,r]));
 const reports=index.reports.map(r=>({id:r.id,runId:r.runId,created:r.created,evidence:{url:url(r.evidence),sha256:r.evidenceSha256},projection:{url:url(r.id+'.summary.json'),sha256:entries.get(r.id).projectionSha256},...(r.trialsEvidence?{trials:{url:url(r.trialsEvidence),sha256:r.trialsEvidenceSha256}}:{}),...(r.throughputEvidence?{throughput:{url:url(r.throughputEvidence),sha256:r.throughputEvidenceSha256}}:{})}));
 await mkdir(destination,{recursive:true});
 await writeFile(join(destination,'index.json'),JSON.stringify({schema:1,type:'immutable-history-archive',sourceIndex:{url:url('index.json'),sha256:digest(original)},reports})+'\n');
 await writeFile(join(destination,'source-index.json'),original);
 await writeFile(join(destination,'weekly.json'),await readFile(join(source,'weekly.json')));
 return true;
}
