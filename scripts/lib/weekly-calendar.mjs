import assert from 'node:assert/strict';
import {digest} from './wasmbench.mjs';
import {historyDate} from './history-align.mjs';

export const weeklyEngines=['wago','wazero','wasmtime','v8','wavm','wasmer'];
export const weeklyZone='America/New_York';

export function weeklyCutoff(date) {
 assert(/^\d{4}-\d{2}-\d{2}$/.test(date),'Expected a Saturday date YYYY-MM-DD');
 const wall=new Date(date+'T23:59:00Z');
 assert(wall.toISOString().startsWith(date) && wall.getUTCDay()===6,'Weekly date must be a valid Saturday');
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:weeklyZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(wall).map(p=>[p.type,p.value]));
 const local=Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute);
 return new Date(+wall+(+wall-local)).toISOString();
}

export function weeklyPinIdentity(set) {
 assert.equal(set.zone,weeklyZone,'Both hosts must use the shared Eastern calendar');
 const cutoff=new Date(set.cutoff).toISOString(),date=historyDate(cutoff);
 assert.equal(cutoff,weeklyCutoff(date),'Weekly cutoff must be Saturday 11:59 PM Eastern');
 assert.equal(set.pins.length,weeklyEngines.length,'Weekly plan must pin all six engines');
 const pins=weeklyEngines.map(engine=>{
  const matches=set.pins.filter(p=>p.engine===engine);
  assert.equal(matches.length,1,'Expected one pin for '+engine);
  const p=matches[0];
  assert.equal(new Date(p.targetWeek).toISOString(),cutoff,'Engine date differs from shared cutoff: '+engine);
  assert.equal(p.status,'planned','Missing exact source pin: '+engine);
  assert(/^[a-f0-9]{40}$/.test(p.revision),'Missing exact source revision: '+engine);
  assert(Number.isFinite(+new Date(p.committedAt)) && +new Date(p.committedAt)<=+new Date(cutoff),'Source commit is newer than cutoff: '+engine);
  return {engine,repository:p.repository,revision:p.revision,configurations:p.configurations};
 });
 return {date,cutoff,zone:weeklyZone,pins,identity:digest(JSON.stringify({cutoff,zone:weeklyZone,pins}))};
}

export function sharedWeeklySnapshot(set,calendar) {
 const snapshot=weeklyPinIdentity(set);
 assert.equal(calendar.schema,1,'Unknown shared historical calendar');
 assert.deepEqual(calendar.machines,['local','hub'],'Weekly history must plan both machines');
 const entry=calendar.weeks.find(w=>w.date===snapshot.date);
 assert(entry,'Register the shared date with just history-week-plan YYYY-MM-DD before collecting: '+snapshot.date);
 assert.equal(snapshot.identity,weeklyPinIdentity(entry).identity,'Host cutoff or source pins differ from shared calendar');
 return {date:snapshot.date,cutoff:snapshot.cutoff,zone:snapshot.zone,pinsSha256:snapshot.identity};
}
