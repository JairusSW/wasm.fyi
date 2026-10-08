// Extend an existing plan without changing any already selected source pin.
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {atomicJSON} from './lib/benchmark-plan.mjs';
import {mergeGoModuleVersions} from './lib/go-module-versions.mjs';
import {engineSources} from './lib/engine-sources.mjs';
const root=resolve(process.argv[2]),planPath=join(root,'source-plan.json');
const engineName=process.argv[3]||'wasm2go';
if(!['wasm2go','wago','wazero'].includes(engineName))throw Error('Not a Go runtime/module engine');
const spec=engineSources[engineName];
const plan=JSON.parse(await readFile(planPath));
const audit=JSON.parse(await readFile(join(root,engineName+'-module-version-audit.json')));
const repository=spec.repository,existing=plan.pins.filter(p=>p.engine===engineName&&p.targetType==='release');
const releases=existing.map(p=>({tag_name:p.tag,published_at:p.publishedAt,html_url:p.url,prerelease:p.prerelease}));
const eligible=audit.versions.filter(info=>Date.parse(info.Time)>=Date.parse(plan.cutoff)&&Date.parse(info.Time)<=Date.parse(plan.anchor));
const versions=mergeGoModuleVersions(repository,releases,eligible);
const known=new Set(existing.map(p=>p.tag)),added=[];
for(const version of versions){
 const time=Date.parse(version.published_at);
 if(known.has(version.tag_name)||time<Date.parse(plan.cutoff)||time>Date.parse(plan.anchor))continue;
 if(version.dateBasis!=='go-module-commit')throw Error('Supplement requires an explicitly dated module version');
 const pin={engine:engineName,targetType:'release',targetWeek:new Date(time).toISOString(),targetRelease:version.tag_name,repository,configurations:spec.configurations,status:'planned',tag:version.tag_name,revision:version.revision,publishedAt:version.published_at,prerelease:version.prerelease,url:version.html_url,datePrecision:version.datePrecision,dateBasis:version.dateBasis,versionTime:version.versionTime};
 plan.pins.push(pin);added.push(pin);
}
for(const engine of plan.engines.filter(e=>e.engine===engineName))engine.planned=plan.pins.filter(p=>p.engine===engineName&&p.status==='planned').length;
await atomicJSON(planPath,plan);
await atomicJSON(join(root,engineName+'-module-pin-supplement.json'),{provider:audit.provider,dateBasis:'Go module commit timestamps; not GitHub publication dates',added,completed:new Date().toISOString()});
console.log(JSON.stringify({added:added.length,pins:plan.pins.length,planned:plan.pins.filter(p=>p.status==='planned').length}));
