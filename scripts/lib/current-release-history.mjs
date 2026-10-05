// One canonical capture for a release shown in both current and history views.
// Archived inputs remain immutable; alias only identical source and artifacts.
export function bindCurrentReleaseHistory(output,reports,release,scenarios) {
 if(!release?.revision)return;
 const byId=new Map(reports.map(r=>[r.id,r]));
 for(const [machine,host] of Object.entries(output.hosts)){
  const history=output.history[machine];
  if(!history)continue;
  const i=history.points.findIndex(p=>p.revision===release.revision);
  if(i<0)continue;
  const slot=Object.keys(output.configurations).find(c=>output.configurations[c]==='wago');
  if(!slot)continue;
  const entries=[];let rejected=false;
  candidates: for(const w of output.catalogue.filter(w=>!w.id.startsWith('features/')))for(const metric of Object.keys(scenarios)){
   const key=`${w.id}|${slot}|${metric}`,cell=host.snapshots.s1[key];
   if(!cell?.report)continue;
   const report=byId.get(cell.report),runtime=report?.runtimes.find(r=>r.id==='wago');
   // Reject mixed source revisions and changed artifacts, including failed cells.
   if(!runtime?.description.runtime_version.startsWith(release.revision+'/') ||
      history.artifactSha256[w.id]!==w.artifactSha256 ||
      !report.workloads.some(item=>item.id===w.id&&item.sha256===w.artifactSha256)){
    rejected=true;break candidates;
   }
   entries.push([key,cell]);
  }
  // Check all entries before changing any historical cell.
  const expected=output.catalogue.filter(w=>!w.id.startsWith('features/')).flatMap(w=>Object.keys(scenarios).map(m=>host.snapshots.s1[`${w.id}|${slot}|${m}`])).filter(c=>c?.report).length;
  if(rejected || !entries.length || entries.length!==expected)continue;
  for(const [key,cell] of entries){
   history.cells[key]??=history.points.map(()=>({st:'nm',report:'',role:'retrospective-revision'}));
   history.cells[key][i]={...cell,role:'retrospective-revision'};
  }
  const capturedAt=entries.map(([,cell])=>byId.get(cell.report).created).filter(Boolean).sort().at(-1);
  if(capturedAt)history.points[i].collectedAt=capturedAt;
  history.points[i].currentLatency={...history.points[i].currentLatency,[slot]:'s1'};
 }
}
