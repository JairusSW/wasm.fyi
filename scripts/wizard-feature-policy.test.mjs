import test from 'node:test';
import assert from 'node:assert/strict';
import {wizardFeatureCommand} from './lib/wizard-feature-policy.mjs';
const revision='399357ce20b8330ddc1888a93cceb0d4cf3762de';
const receipt=()=>({configuration:'wizard-v3-int',revision,command:['java','-jar','wizard.jar','--mode=v3-int','--invoke=wasmfyi-bench','wasmfyi-bench.wasm'],files:{'wizard.jar':'original-hash'}});
test('cached Wizard commands opt into declared legacy exceptions without changing artifacts',()=>{
 const before=receipt(),after=wizardFeatureCommand(before,before.configuration,revision);
 assert.deepEqual(after.command,['java','-jar','wizard.jar','--mode=v3-int','--ext:legacy-eh','--invoke=wasmfyi-bench','wasmfyi-bench.wasm']);
 assert.deepEqual(after.files,before.files);assert.equal(before.command.includes('--ext:legacy-eh'),false);
 assert.equal(wizardFeatureCommand(after,after.configuration,revision),after);
});
test('Wizard command migration is source bound and rejects mismatched receipts',()=>{
 const before=receipt();assert.equal(wizardFeatureCommand(before,before.configuration,'unknown'),before);
 assert.throws(()=>wizardFeatureCommand({...before,revision:'wrong'},before.configuration,revision),/identity mismatch/);
 assert.throws(()=>wizardFeatureCommand(before,'wizard-spc',revision),/identity mismatch/);
 assert.throws(()=>wizardFeatureCommand({...before,command:['wizard']},before.configuration,revision),/anchor absent/);
});
