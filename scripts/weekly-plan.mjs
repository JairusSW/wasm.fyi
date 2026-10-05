// Resolve one shared source snapshot for both native machines.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {site} from './lib/wasmbench.mjs';
import {atomicJSON} from './lib/benchmark-plan.mjs';
import {pinMain} from './lib/engine-sources.mjs';
import {weeklyCutoff,weeklyEngines,weeklyZone,weeklyPinIdentity,sharedWeeklySnapshot} from './lib/weekly-calendar.mjs';
const date=process.argv[2],cutoff=weeklyCutoff(date);
assert(+new Date(cutoff)<=Date.now(),'Historical Saturday has not finished yet');
const path=join(site,'data/history-calendar.json');
const calendar=JSON.parse(await readFile(path));
let entry=calendar.weeks.find(w=>w.date===date);
if(!entry){
 const configurations={wago:['wago'],wazero:['wazero'],wasmtime:['wasmtime'],v8:['v8'],wavm:['wavm'],wasmer:['wasmer-singlepass']};
 const pins=[];
 for(const engine of weeklyEngines){
  const [pin]=await pinMain(engine,[cutoff]);
  pins.push({...pin,configurations:configurations[engine]});
 }
 entry={date,cutoff,zone:weeklyZone,pins};
 weeklyPinIdentity(entry);
 calendar.weeks.push(entry);calendar.weeks.sort((a,b)=>a.date.localeCompare(b.date));
 await atomicJSON(path,calendar);
}
const snapshot=sharedWeeklySnapshot(entry,calendar);
const base=join(site,'.wasmbench','weekly-'+date.replaceAll('-',''));
for(const machine of calendar.machines){
 const directory=machine==='local'?base:join(base,machine);await mkdir(directory,{recursive:true});
 const pinPath=join(directory,'pins.json');
 const previous=await readFile(pinPath,'utf8').then(JSON.parse,()=>null);
 if(previous)assert.deepEqual(sharedWeeklySnapshot(previous,calendar),snapshot,'Existing host plan differs');
 else await atomicJSON(pinPath,entry);
}
console.log(`${date} 11:59 PM Eastern · ${snapshot.cutoff} · identical pins for ARM64 and AMD64`);
for(const pin of entry.pins)console.log(`${pin.engine}: ${pin.revision}`);
