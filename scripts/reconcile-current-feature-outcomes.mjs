// Metadata-only reconciliation uses the same lock order as feature collection.
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {acquireMeasurementLock,withBuildLock} from './lib/measurement-lock.mjs';
import {reconcileFeatureClassifications} from './reconcile-feature-classifications.mjs';
const root=resolve(process.argv[2]),ledgerDirectory=join(root,'latest-features');
const config=JSON.parse(await readFile(join(root,'runner-config.json'),'utf8'));
const release=await acquireMeasurementLock(join(ledgerDirectory,'ledger-writer-lock'));
try{
 await withBuildLock(root,async()=>{
  const result=await reconcileFeatureClassifications({campaign:root,ledgerDirectory,inputs:config.inputs,write:true});
  const receipt={checkedAt:new Date().toISOString(),...result};
  await writeFile(join(root,'reconciled-feature-outcomes.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify({...receipt,unresolved:undefined,unresolvedCount:result.unresolved.length}));
 });
}finally{await release()}
