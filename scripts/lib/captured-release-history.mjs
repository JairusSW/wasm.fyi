import {historyDate} from './history-align.mjs';

// Project existing sealed release captures into history, without altering archives.
export function bindCapturedReleases(output,reports,releases,metrics) {
 const byId=new Map(reports.map(r=>[r.id,r]));
 for(const [machine,host] of Object.entries(output.hosts))for(const release of releases){
  const h=output.history[machine];if(!h)continue;
  const slot=Object.keys(output.configurations).find(c=>output.configurations[c]===release.runtime);if(!slot)continue;
  const entries=[];let rejected=false;
  candidates: for(const w of output.catalogue.filter(w=>!w.id.startsWith('features/')))for(const metric of metrics){
   const key=`${w.id}|${slot}|${metric}`,cell=host.snapshots.s1[key];if(!cell?.report)continue;
   const report=byId.get(cell.report),runtime=report?.runtimes.find(r=>r.id===release.runtime);
   if(runtime?.description.runtime_version!==release.version || h.artifactSha256[w.id]!==w.artifactSha256 ||
      !report.workloads.some(item=>item.id===w.id&&item.sha256===w.artifactSha256)){
    // Auxiliary observations may still belong to an older release. Do not
    // attach them to this release or discard the matching timing capture.
    if(!['compile','inst','first','steady'].includes(metric))continue;
    rejected=true;break candidates;
   }
   entries.push([key,cell]);
  }
  if(rejected||!entries.some(([key])=>key.endsWith('|steady')))continue;
  const date=historyDate(release.publishedAt);let i=h.points.findIndex(p=>p.date===date);
  if(i<0){
   i=h.points.length;h.points.push({date,revision:'',status:'measured'});
   for(const cells of Object.values(h.cells))cells.push({st:'nm',report:'',role:'retrospective-revision'});
   for(const versions of Object.values(h.versions))versions.push('not collected');
  }
  for(const [key,cell] of entries){
   h.cells[key]??=h.points.map(()=>({st:'nm',report:'',role:'retrospective-revision'}));
   h.cells[key][i]={...cell,role:'retrospective-revision'};
  }
  const point=h.points[i];point.status='measured';
  point.collectedAt=[point.collectedAt,...entries.map(([,c])=>byId.get(c.report).created)].filter(Boolean).sort().at(-1);
  point.currentLatency={...point.currentLatency,[slot]:'s1'};
  point.releases={...point.releases,[slot]:{version:release.version,publishedAt:release.publishedAt,url:release.url}};
  h.versions[slot]??=h.points.map(()=> 'not collected');h.versions[slot][i]=release.version;
 }
}
