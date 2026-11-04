#!/usr/bin/env node
// Reuse only an exact-source SDK with the current declared-feature policy.
import {readFile,stat,symlink,mkdir,writeFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {join,resolve} from 'node:path';
import {withBuildLock} from './lib/measurement-lock.mjs';
import {historyBuildKey} from './lib/history-build-cache.mjs';

const args=process.argv.slice(2);
if(args.length!==2)throw Error('Usage: reuse-current-wavm-sdk.mjs CURRENT_ROOT PRIOR_ROOT');
const [root,prior]=args.map(path=>resolve(path));
const plan=JSON.parse(await readFile(join(root,'source-plan.json'),'utf8'));
const pin=plan.pins.find(p=>p.engine==='wavm'&&p.status==='planned');
if(!pin)throw Error('No planned WAVM pin');
const key=historyBuildKey(pin,'wavm'),source=join(prior,'sdk-builds',key),target=join(root,'sdk-builds',key);
const hash=async path=>{const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);return h.digest('hex');};
await withBuildLock(root,async()=>{
 if(await stat(target).catch(()=>null))throw Error('Target SDK already exists; leave it untouched');
 const receipt=JSON.parse(await readFile(join(source,'wavm-build.json'),'utf8'));
 if(receipt.pin?.revision!==pin.revision||receipt.pin?.targetType!==pin.targetType)throw Error('Source pin mismatch');
 const policy=receipt.provenance?.featurePolicy;
 if(policy?.version!=='wavm-declared-features-v1')throw Error('Cached SDK lacks current feature policy');
 for(const feature of ['simd','atomics','exception-handling','multivalue','reference-types','extended-name-section','multi-memory','memory64'])if(!policy.features.includes(feature))throw Error('Missing feature '+feature);
 const adapter=join(receipt.root,'bin/adapter-wavm');
 const files={...receipt.runtime?.file_sha256};
 const adapterReal=await realpath(adapter);
 let adapterHasFingerprint=false;
 for(const path of Object.keys(files))if(await realpath(path)===adapterReal)adapterHasFingerprint=true;
 if(!adapterHasFingerprint)throw Error('Missing adapter fingerprint');
 const sdk=receipt.provenance.sdk;
 if(!sdk?.libraries?.length)throw Error('Missing SDK fingerprints');
 for(const lib of sdk.libraries)files[join(sdk.sdk,'lib',lib.name)]=lib.sha256;
 for(const [path,expected] of Object.entries(files))if(await hash(path)!==expected)throw Error('Cached dependency changed: '+path);
 await mkdir(join(root,'sdk-builds'),{recursive:true});
 await symlink(source,target);
 const result={source,target,revision:pin.revision,verifiedFiles:Object.keys(files).length,at:new Date().toISOString()};
 await writeFile(join(root,'wavm-sdk-reuse.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result));
});
