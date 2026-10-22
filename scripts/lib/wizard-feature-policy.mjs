import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {atomicJSON} from './benchmark-plan.mjs';

const revision='399357ce20b8330ddc1888a93cceb0d4cf3762de';
export function wizardFeatureCommand(receipt,engine,sourceRevision){
 if(sourceRevision!==revision)return receipt;
 if(receipt.revision!==sourceRevision||receipt.configuration!==engine||!Array.isArray(receipt.command))throw Error('Wizard feature command identity mismatch');
 if(receipt.command.includes('--ext:legacy-eh'))return receipt;
 const index=receipt.command.findIndex(value=>value==='--invoke=wasmfyi-bench');
 if(index<0)throw Error('Wizard feature command invocation anchor absent');
 const command=[...receipt.command];command.splice(index,0,'--ext:legacy-eh');
 return {...receipt,command};
}
// Caller holds the project measurement reservation. Artifact hashes are preserved.
export async function upgradeWizardFeatureCommand(harness,engine,sourceRevision){
 if(sourceRevision!==revision)return;
 const path=join(harness,'bin',engine+'-command.json');
 const before=JSON.parse(await readFile(path,'utf8'));
 const after=wizardFeatureCommand(before,engine,sourceRevision);
 if(after!==before)await atomicJSON(path,after);
}
