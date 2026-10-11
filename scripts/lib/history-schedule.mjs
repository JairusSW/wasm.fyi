import {historyPinAllowed} from './history-window.mjs';

// Every engine gets its newest weekly target before any older week starts.
// Reused pins remain in the schedule so their aliases have an explicit slot.
export function historySchedule(plan,template,engineOrder) {
 const eligible=plan.pins.filter(pin=>historyPinAllowed(pin,template)&&['planned','reused'].includes(pin.status));
 const weeks=[...new Set(eligible.map(pin=>new Date(pin.targetWeek).toISOString()))].sort((a,b)=>Date.parse(b)-Date.parse(a));
 return weeks.map((week,index)=>({week,latest:index===0,engines:engineOrder.filter(engine=>eligible.some(pin=>pin.engine===engine&&new Date(pin.targetWeek).toISOString()===week))}));
}
export function historyWeekMatches(pin,week) {
 if(!week)return true;
 if(!Number.isFinite(Date.parse(week)))throw Error('Invalid selected history week');
 return new Date(pin.targetWeek).toISOString()===new Date(week).toISOString();
}
