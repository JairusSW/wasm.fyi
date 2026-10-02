import assert from 'node:assert/strict';
import { digest } from './wasmbench.mjs';
const day=86400000,week=7*day;
export function wednesdays(now=new Date(),count=8,previous=[]) {
  assert(Number.isSafeInteger(count)&&count>=1&&count<=52,'History weeks must be 1..52');
  const end=new Date(now);assert(Number.isFinite(+end),'Invalid history anchor');
  end.setUTCHours(0,0,0,0);end.setUTCDate(end.getUTCDate()-(end.getUTCDay()+4)%7);
  const valid=previous.map(p=>new Date(p.targetWeek)).filter(d=>Number.isFinite(+d)&&d.getUTCDay()===3&&+d<=+end);
  const start=Math.min(+end-(count-1)*week,...valid.map(Number));
  return Array.from({length:Math.floor((+end-start)/week)+1},(_,i)=>new Date(start+i*week).toISOString());
}
export function snapshotKey({engine,revision,suiteSha256,recipeSha256,host,configurations,options}) {
  return digest(JSON.stringify({engine,revision,suiteSha256,recipeSha256,host,configurations,options}));
}
export const weeklyPolicy='Wednesday 00:00 UTC targets. Each engine uses the latest published non-development release available at that instant; no main, dirty or nightly builds. Published prereleases retain their prerelease label. Measurements run retrospectively on the recorded host and fixed corpus; collectedAt is never backdated. Repeated release identities can reuse verified measurements; missing releases and runners remain explicit gaps.';
