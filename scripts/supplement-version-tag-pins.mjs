import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {engineSources} from './lib/engine-sources.mjs';
import {atomicJSON} from './lib/benchmark-plan.mjs';
const root=resolve(process.argv[2]),path=join(root,'source-plan.json');
const plan=JSON.parse(await readFile(path));
const audit=JSON.parse(await readFile(join(root,'version-tag-date-audit.json')));
if(audit.anchor!==plan.anchor||audit.cutoff!==plan.cutoff)throw Error('Version tag audit bounds differ from source plan');
const added=[];
for(const row of audit.results){
 // Go registries include deleted tags and establish the version identities.
 if(['wago','wazero','wasm2go'].includes(row.engine))continue;
 const spec=engineSources[row.engine];
 if(row.status!=='audited'||spec.repository!==row.repository)throw Error('Unverified tag inventory');
 for(const tag of row.unplannedYtdTags){
  if(!/^v?\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(tag.tag))throw Error('Unrecognized version tag '+tag.tag);
  if(!/^[a-f0-9]{40}$/.test(tag.revision)||!Number.isFinite(Date.parse(tag.committedAt)))throw Error('Invalid tagged source');
  const time=Date.parse(tag.committedAt);
  if(time<Date.parse(plan.cutoff)||time>Date.parse(plan.anchor))throw Error('Tagged source outside YTD bounds');
  if(plan.pins.some(p=>p.engine===row.engine&&p.targetType==='release'&&p.tag===tag.tag))continue;
  const pin={engine:row.engine,targetType:'release',targetWeek:new Date(time).toISOString(),targetRelease:tag.tag,repository:row.repository,configurations:spec.configurations,status:'planned',tag:tag.tag,revision:tag.revision,committedAt:tag.committedAt,url:'https://github.com/'+row.repository+'/commit/'+tag.revision,datePrecision:'commit',dateBasis:'git-tag-commit'};
  plan.pins.push(pin);added.push(pin);
 }
}
for(const engine of plan.engines)engine.planned=plan.pins.filter(p=>p.engine===engine.engine&&p.status==='planned').length;
await atomicJSON(path,plan);
await atomicJSON(join(root,'version-tag-pin-supplement.json'),{completed:new Date().toISOString(),dateBasis:'Tagged commit timestamps, not publication dates',added});
console.log(JSON.stringify({added:added.length,pins:plan.pins.length}));
