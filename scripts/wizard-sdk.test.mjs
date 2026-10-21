import test from 'node:test';
import assert from 'node:assert/strict';
import {wizardArchitectureUnavailable,ensureWizardCompiler,wizardVirgilRevision,wizardFeatureFlags} from './lib/wizard-sdk.mjs';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('Wizard compiler resumes interrupted initialization but refuses external or mismatched checkouts',async()=>{
 const virgil=await mkdtemp(join(tmpdir(),'wizard-compiler-'));
 await mkdir(join(virgil,'.git'));
 try {
  let head=null;const calls=[];
  const run=async(_,args)=>{
   calls.push(args[2]);
   if(args[2]==='rev-parse'){if(!head)throw Error('missing HEAD');return {output:head};}
   if(args[2]==='checkout')head=args.at(-1);
   return {output:''};
  };
  await assert.rejects(ensureWizardCompiler({virgil,external:true,run}),/missing HEAD/);
  assert.deepEqual(calls,['rev-parse']);calls.length=0;
  assert.equal(await ensureWizardCompiler({virgil,run}),wizardVirgilRevision);
  assert.deepEqual(calls,['rev-parse','fetch','checkout','rev-parse']);calls.length=0;
  await ensureWizardCompiler({virgil,run});assert.deepEqual(calls,['rev-parse']);calls.length=0;
  head='f'.repeat(40);
  await assert.rejects(ensureWizardCompiler({virgil,run}),/differs/);
  assert.deepEqual(calls,['rev-parse']);
 } finally {await rm(virgil,{recursive:true,force:true});}
});
test('Wizard source targets expose portable interpretation and reject unavailable native backends explicitly',()=>{
 for(const host of [{platform:'darwin',architecture:'arm64'},{platform:'linux',architecture:'arm64'},{platform:'darwin',architecture:'x64'}]){
  assert.equal(wizardArchitectureUnavailable('wizard-v3-int',host),null);
  for(const configuration of ['wizard-fast-int','wizard-spc']){
   const proof=wizardArchitectureUnavailable(configuration,host);
   assert.equal(proof.configuration,configuration);
   assert.equal(proof.platform,host.platform);
   assert.match(proof.reason,/Linux AMD64/);
  }
 }
 for(const configuration of ['wizard-v3-int','wizard-fast-int','wizard-spc'])assert.equal(wizardArchitectureUnavailable(configuration,{platform:'linux',architecture:'x64'}),null);
 assert.throws(()=>wizardArchitectureUnavailable('wizard-other'),/Unknown/);
});
test('Wizard opts into every extension exposed by the pinned CLI',()=>{
 assert.deepEqual(wizardFeatureFlags,['--ext:custom-page-sizes','--ext:stack-switching','--ext:threads','--ext:wide-arithmetic']);
});
