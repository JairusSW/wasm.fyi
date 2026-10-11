// A collection boundary changes scheduling, never the retained source plan or
// existing captures. Weeks are selected by their planned snapshot date.
export function historyPinAllowed(pin,template={}) {
 const boundary=template.historyNotBefore;
 if(boundary==null)return true;
 if(typeof boundary!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(boundary)||new Date(boundary).toISOString().slice(0,10)!==boundary)throw Error('Invalid historyNotBefore date');
 const week=Date.parse(pin.targetWeek);
 if(!Number.isFinite(week))throw Error('History pin has no valid targetWeek');
 return week>=Date.parse(boundary+'T00:00:00.000Z');
}
