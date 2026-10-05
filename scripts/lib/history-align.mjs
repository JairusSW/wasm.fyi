export function historyDate(timestamp) {
  if(/^\d{4}-\d{2}-\d{2}$/.test(timestamp))return timestamp;
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(timestamp)).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// Keep shared chart indices aligned without inventing evidence for another host.
export function alignHistoryDates(histories) {
  const dates=[...new Set(Object.values(histories).flatMap(h=>h.points.map(p=>p.date)))].sort();
  for(const h of Object.values(histories)){
    const indices=new Map(h.points.map((p,i)=>[p.date,i]));
    h.points=dates.map(date=>indices.has(date)?h.points[indices.get(date)]:{date,revision:'',status:'not-collected'});
    for(const [key,cells] of Object.entries(h.cells))h.cells[key]=dates.map(date=>indices.has(date)?cells[indices.get(date)]:{st:'nm',report:'',role:'retrospective-revision',launchMedians:[]});
    for(const [key,versions] of Object.entries(h.versions))h.versions[key]=dates.map(date=>indices.has(date)?versions[indices.get(date)]:'not collected');
  }
}
