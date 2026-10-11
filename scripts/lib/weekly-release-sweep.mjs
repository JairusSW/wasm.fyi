import {monthsBefore} from './weekly-history.mjs';

const calendar=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function easternSunday(date) {
 const wall=Date.parse(date+'T06:00:00Z');
 // Iterate the offset: daylight saving can change between the initial guess
 // and the intended Sunday morning. 06:00 is never an ambiguous wall time.
 let instant=wall;
 for(let i=0;i<3;i++){
  const p=Object.fromEntries(calendar.formatToParts(new Date(instant)).map(p=>[p.type,p.value]));
  const rendered=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute);
  instant+=wall-rendered;
 }
 return new Date(instant).toISOString();
}

export function sweepWeeks(anchor=new Date().toISOString(),months=6) {
 const now=new Date(anchor);if(!Number.isFinite(+now))throw Error('Invalid sweep anchor');
 const cutoff=monthsBefore(anchor,months);
 const p=Object.fromEntries(calendar.formatToParts(now).map(p=>[p.type,p.value]));
 const sunday=new Date(Date.UTC(+p.year,+p.month-1,+p.day));
 sunday.setUTCDate(sunday.getUTCDate()-sunday.getUTCDay());
 const weeks=[];
 // Include this week's partial interval through now, then full weeks backwards.
 let end=now.toISOString();
 for(;;){
  const boundary=easternSunday(sunday.toISOString().slice(0,10));
  if(Date.parse(boundary)>Date.parse(end)){sunday.setUTCDate(sunday.getUTCDate()-7);continue}
  const start=Date.parse(boundary)<Date.parse(cutoff)?cutoff:boundary;
  if(Date.parse(end)>Date.parse(start))weeks.push({start,end});
  if(Date.parse(boundary)<=Date.parse(cutoff))break;
  end=boundary;sunday.setUTCDate(sunday.getUTCDate()-7);
 }
 return {anchor:now.toISOString(),cutoff,zone:'America/New_York',weeks};
}

export function releaseInWeek(engine,releases,{start,end}) {
 const eligible=releases.filter(r=>!r.draft&&Date.parse(r.published_at)>Date.parse(start)&&Date.parse(r.published_at)<=Date.parse(end));
 const selected=engine==='wago'?eligible.filter(r=>/beta/i.test(r.tag_name)):
  engine==='wavm'?eligible:eligible.filter(r=>!r.prerelease&&!/nightly|snapshot|canary|(?:^|[-/])dev(?:[-/]|$)/i.test(r.tag_name));
 return selected.sort((a,b)=>Date.parse(b.published_at)-Date.parse(a.published_at)||a.tag_name.localeCompare(b.tag_name))[0]||null;
}

export function deduplicateSweep(pins) {
 const seen=new Map();
 return pins.map(pin=>{
  if(pin.status!=='planned')return pin;
  if(!/^[a-f0-9]{40}$/.test(pin.revision))throw Error('Sweep needs resolved source revisions');
  const key=JSON.stringify([pin.engine,pin.revision,[...pin.configurations].sort()]);
  if(seen.has(key))return {...pin,status:'reused',reuseTargetWeek:seen.get(key)};
  seen.set(key,pin.targetWeek);return pin;
 });
}
