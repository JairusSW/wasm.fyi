// Preserve completed captures for byte-identical contracts after a frozen input-set update.
import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {digest} from './lib/wasmbench.mjs';
import {atomicJSON} from './lib/benchmark-plan.mjs';
import {featureCampaignPlatform} from './lib/feature-campaign-identity.mjs';
import {migrateFeatureLedger} from './lib/feature-ledger-migration.mjs';

const [campaignArg,rootArg,oldInputsArg,newInputsArg]=process.argv.slice(2).filter(arg=>arg!=='--apply');
if(!campaignArg||!rootArg||!oldInputsArg||!newInputsArg)throw Error('Usage: migrate-feature-input-ledger CAMPAIGN FEATURE_ROOT OLD_INPUTS NEW_INPUTS [--apply]');
const campaign=resolve(campaignArg),root=resolve(rootArg),oldInputs=resolve(oldInputsArg),newInputs=resolve(newInputsArg),apply=process.argv.includes('--apply');
const read=path=>readFile(path,'utf8').then(JSON.parse);
const readSuites=async directory=>Object.fromEntries(await Promise.all(['compatibility','performance','compile','lifecycle'].map(async kind=>[kind,await read(join(directory,kind+'.json'))])));
const ledgerPath=join(root,'ledger.json'),ledger=await read(ledgerPath),template=await read(join(campaign,'collection-template.json'));
const platform=featureCampaignPlatform(template),hostKey=digest(Buffer.from(JSON.stringify(platform)));
const {ledger:migrated,summary}=migrateFeatureLedger({ledger,oldSuites:await readSuites(oldInputs),newSuites:await readSuites(newInputs),hostKey});
const receipt={schema:1,createdAt:new Date().toISOString(),applied:apply,platform,hostKey,...summary};
if(apply){
 const backup=ledgerPath+'.before-input-migration-'+Date.now();await copyFile(ledgerPath,backup);await atomicJSON(ledgerPath,migrated);receipt.backup=backup;
 await writeFile(join(root,'input-migration-'+summary.newInputIdentity+'.json'),JSON.stringify(receipt,null,2)+'\n');
}
console.log(JSON.stringify(receipt,null,2));
