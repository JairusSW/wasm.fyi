// Describe exact capture keys to the SQLite reuser without duplicating JS hashes.
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {digest} from './lib/wasmbench.mjs';
import {workloadContract} from './lib/workload-contract.mjs';
import {featureScenarios} from './lib/feature-scenario-policy.mjs';
import {featureCampaignPlatform,featureInputIdentity,featureLedgerKey} from './lib/feature-campaign-identity.mjs';
import {latestFeaturePins} from './lib/latest-feature-pins.mjs';
const [campaignArg,inputsArg,outputArg]=process.argv.slice(2);
if(!campaignArg||!inputsArg||!outputArg)throw Error('Usage: export-feature-reuse CAMPAIGN INPUTS OUTPUT');
const campaign=resolve(campaignArg),inputs=resolve(inputsArg);
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const plan=await read(join(campaign,'source-plan.json')),template=await read(join(campaign,'collection-template.json'));
const suites={};
for(const kind of ['compatibility','performance','compile','lifecycle']){
 suites[kind]=await read(join(inputs,kind+'.json'));
 for(const w of suites[kind])if(digest(await readFile(resolve(inputs,w.artifact)))!==w.sha256)throw Error('Feature artifact differs: '+w.id);
}
const platform=featureCampaignPlatform(template),hostKey=digest(Buffer.from(JSON.stringify(platform))),inputIdentity=featureInputIdentity(suites);
const workloads=Object.entries(suites).flatMap(([kind,list])=>list.map(workload=>({kind,workload,contract:workloadContract(workload),phases:featureScenarios(kind,workload).split(',')})));
const targets=latestFeaturePins(plan.pins).filter(p=>!plan.excludedEngines?.includes(p.engine)).flatMap(pin=>pin.configurations.map(engine=>{
 const source={repository:pin.repository,revision:pin.revision,ref:pin.tag||'main@'+pin.revision.slice(0,['wago','wazero','wasm2go','libwasm'].includes(pin.engine)?12:8),kind:pin.tag?'release':'snapshot',asOf:pin.targetWeek,...(pin.dateBasis?{dateBasis:pin.dateBasis}:{})};
 return {engine,source,keys:workloads.map(({kind,workload})=>featureLedgerKey(hostKey,engine,source,kind,workload,inputIdentity))};
}));
await writeFile(resolve(outputArg),JSON.stringify({schema:1,anchor:plan.anchor,manifestIdentity:await read(join(inputs,'identity.json')),platform,hostKey,inputIdentity,workloads,targets})+'\n');
console.log(JSON.stringify({workloads:workloads.length,configurations:targets.length,host:platform.cpu,inputIdentity}));
