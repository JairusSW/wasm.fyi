import {monthsBefore} from './weekly-history.mjs';
import {weeklyCutoff} from './weekly-calendar.mjs';
import {historyDate} from './history-align.mjs';
export function releaseWeekPlan(original,{anchor=original.anchor,months=3,samples=5}={}) {
 const cutoff=monthsBefore(anchor,months);
 const releases=original.pins.filter(p=>p.status==='planned'&&p.targetType==='release'&&p.dateBasis!=='git-tag-commit'&&Date.parse(p.targetWeek)>=Date.parse(cutoff)&&Date.parse(p.targetWeek)<=Date.parse(anchor)&&(p.engine!=='wago'||/^v\d+\.\d+\.\d+-beta\.\d+$/.test(p.tag)));
 const snapshots=original.pins.filter(p=>p.status==='planned'&&p.targetType==='main'&&Date.parse(p.targetWeek)>=Date.parse(cutoff)&&Date.parse(p.targetWeek)<=Date.parse(anchor)).filter(p=>{
  const date=new Date(historyDate(p.targetWeek)+'T00:00:00Z');date.setUTCDate(date.getUTCDate()-7);
  const start=Date.parse(weeklyCutoff(date.toISOString().slice(0,10)))+60000,end=Date.parse(p.targetWeek)+60000;
  return !releases.some(r=>r.engine===p.engine&&Date.parse(r.targetWeek)>=start&&Date.parse(r.targetWeek)<end);
 });
 const seen=new Set(),pins=[...releases,...snapshots].sort((a,b)=>Date.parse(b.targetWeek)-Date.parse(a.targetWeek)||Number(b.targetType==='release')-Number(a.targetType==='release')).map(p=>{
  const key=p.engine+'|'+(p.revision||p.tag);
  if(seen.has(key))return {...p,status:'duplicate-source',reason:'This exact commit/version is measured once per machine and configuration.'};
  seen.add(key);return {...p};
 });
 return {...original,anchor,cutoff,samples,minimumSamples:samples,months,pins,status:'planned',policy:'Every release in the last three months; Wago betas only. For completed weeks without a release, choose the closest eligible main commit to Saturday night. Stop before source history exists. Measure each exact source once per machine/configuration; proceed round-robin through engines independently on each machine.'};
}
