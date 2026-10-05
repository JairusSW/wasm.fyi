import assert from 'node:assert/strict';
import { digest } from './wasmbench.mjs';
import {weeklyCutoff} from './weekly-calendar.mjs';
import {historyDate} from './history-align.mjs';
const day=86400000,week=7*day;
export function saturdays(now=new Date(),count=18,previous=[]) {
  assert(Number.isSafeInteger(count)&&count>=1&&count<=53,'History weeks must be 1..53');
  const anchor=new Date(now);assert(Number.isFinite(+anchor),'Invalid history anchor');
  const end=new Date(historyDate(anchor.toISOString())+'T00:00:00Z');
  end.setUTCDate(end.getUTCDate()-(end.getUTCDay()+1)%7);
  const date=value=>new Date(value).toISOString().slice(0,10);
  if(+new Date(weeklyCutoff(date(end)))>+anchor)end.setUTCDate(end.getUTCDate()-7);
  const valid=previous.map(p=>{
    const value=new Date(p.targetWeek);if(!Number.isFinite(+value))return NaN;
    // Earlier planners used UTC midnight; retain their Saturday calendar date.
    const calendar=value.toISOString().endsWith('T00:00:00.000Z')?date(value):historyDate(value.toISOString());
    const wall=new Date(calendar+'T00:00:00Z');return wall.getUTCDay()===6&&+wall<=+end?+wall:NaN;
  }).filter(Number.isFinite);
  const start=Math.min(+end-(count-1)*week,...valid);
  return Array.from({length:Math.floor((+end-start)/week)+1},(_,i)=>weeklyCutoff(date(start+i*week)));
}
export function monthsBefore(anchor,months) {
  const value=new Date(anchor),day=value.getUTCDate();assert(Number.isInteger(months)&&months>=0,'Invalid month offset');
  assert(Number.isFinite(+value),'Invalid history anchor');value.setUTCDate(1);value.setUTCMonth(value.getUTCMonth()-months);
  const lastDay=new Date(Date.UTC(value.getUTCFullYear(),value.getUTCMonth()+1,0)).getUTCDate();
  value.setUTCDate(Math.min(day,lastDay));return value.toISOString();
}
export function snapshotKey({engine,revision,suiteSha256,recipeSha256,host,configurations,options}) {
  return digest(JSON.stringify({engine,revision,suiteSha256,recipeSha256,host,configurations,options}));
}
export const weeklyPolicy='Saturday 11:59 PM America/New_York targets (including daylight-saving changes) across the latest four months. Each engine pins its upstream default-branch commit for weekly main tracking and separately pins every eligible release in the window. Mainline measurements form a dimmed trend line; individually released versions are bold history points. Release eligibility: Wago beta releases, WAVM prereleases/tags, and stable releases for other engines. Measurements run on the recorded host and fixed corpus; collectedAt is never backdated. Repeated source identities can reuse verified measurements; missing releases, branches, and runners remain explicit gaps.';
