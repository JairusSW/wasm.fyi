import assert from 'node:assert/strict';
import { digest } from './wasmbench.mjs';
const day=86400000,week=7*day;
export function saturdays(now=new Date(),count=18,previous=[]) {
  assert(Number.isSafeInteger(count)&&count>=1&&count<=53,'History weeks must be 1..53');
  const end=new Date(now);assert(Number.isFinite(+end),'Invalid history anchor');
  end.setUTCHours(0,0,0,0);end.setUTCDate(end.getUTCDate()-(end.getUTCDay()+1)%7);
  const valid=previous.map(p=>new Date(p.targetWeek)).filter(d=>Number.isFinite(+d)&&d.getUTCDay()===6&&+d<=+end);
  const start=Math.min(+end-(count-1)*week,...valid.map(Number));
  return Array.from({length:Math.floor((+end-start)/week)+1},(_,i)=>new Date(start+i*week).toISOString());
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
export const weeklyPolicy='Saturday 00:00 UTC targets across the latest four months. Each engine pins its upstream default-branch commit for weekly main tracking and separately pins every eligible release in the window. Mainline measurements form a dimmed trend line; individually released versions are bold history points. Release eligibility: Wago beta releases, WAVM prereleases/tags, and stable releases for other engines. Measurements run on the recorded host and fixed corpus; collectedAt is never backdated. Repeated source identities can reuse verified measurements; missing releases, branches, and runners remain explicit gaps.';
