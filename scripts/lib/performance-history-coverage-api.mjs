import assert from 'node:assert/strict';
import {digest} from './wasmbench.mjs';
import {historicalCoverageRecords} from './performance-history-coverage.mjs';
import {publicationClient} from './api-publish.mjs';
// Match Go's canonical JSON escaping for attestation/receipt identities. Values
// remain unchanged; this is independent of the logical coverage-cell recipe.
export const coverageWireJSON=value=>JSON.stringify(value).replace(/[<>&\u2028\u2029]/g,value=>'\\u'+value.charCodeAt(0).toString(16).padStart(4,'0'));

export function* historyCoverageJobs(input){
 const scope=digest(Buffer.from(JSON.stringify(['history-coverage-scope-v1',input.queue.host,input.queue.corpusSha256,input.queue.recipeSha256])));
 let page=[];
 const job=historyCoverage=>({schema:3,kind:'history-coverage',session:'coverage-'+scope,machine:input.queue.host.replace('/','-'),corpus:'history-coverage',attempt:digest(Buffer.from(coverageWireJSON(historyCoverage))),plan:scope,status:'completed',exports:[],historyCoverage});
 for(const record of historicalCoverageRecords(input)){page.push(record.data);if(page.length===100){yield job(page);page=[]}}
 if(page.length)yield job(page);
}
export async function publishHistoryCoverage({queue,ledger,configured,url,token=process.env.WASMFYI_ADMIN_TOKEN,request=fetch,signal}){
 const call=publicationClient({url,token,request,signal});let revision=null,imports=0;
 for(const job of historyCoverageJobs({queue,ledger,configured})){
  signal?.throwIfAborted();const body=coverageWireJSON(job);assert(Buffer.byteLength(body)<=1024*1024,'Coverage publication exceeds envelope budget');
  const submitted=await call('/admin/v1/imports','POST',body),id=digest(Buffer.from(body));assert.equal(submitted.id,id,'Coverage receipt identity differs');
  const committed=await call('/admin/v1/imports/'+id+'/commit','POST');assert(/^[a-f0-9]{64}$/.test(committed.revision),'Invalid coverage revision');revision=committed.revision;imports++;
 }
 if(imports){const current=await call('/api/v1/manifest');assert(/^[a-f0-9]{64}$/.test(current.revision),'Invalid current coverage publication');revision=current.revision}
 return {revision,imports};
}
