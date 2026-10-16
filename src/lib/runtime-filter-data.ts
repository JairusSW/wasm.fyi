import type {ViewData} from './api/view-contract';
import type {Cfg, MachineId} from './data/types';
import type {RuntimeFilterRow, FilterMetric} from './runtime-filters';
/** One linear scan per published dataset, not per search keystroke. Units match view cells. */
export function runtimeFilterRows(view:ViewData,machine:MachineId,configs:readonly Cfg[],features:boolean,average:'mean'|'geo'):RuntimeFilterRow[]{
 const host=view.hosts[machine],cells=host.snapshots.s1;
 const workloads=view.catalogue.filter(w=>w.id.startsWith('features/')===features);
 const familyCorpora=new Set(workloads.filter(w=>w.id.split('/')[3]?.startsWith('performance-')).map(w=>w.id.split('/').slice(0,3).join('/')));
 return configs.map(c=>{
  const suites=view.featureVersions[machine].find(v=>v.id===view.configurations[c.id])?.features;
  const eligible=new Set(suites?.filter(f=>f.total>0&&f.pass===f.total&&f.contracts.length===f.total&&f.contracts.every(w=>w.status==='passed')).map(f=>f.id));
  const values:RuntimeFilterRow['values']={};
  for(const metric of ['steady','compile','inst','first','rss','code'] as FilterMetric[]){
   let count=0,sum=0,logs=0,zero=false;
   for(const w of workloads){
    if(features){
     if(!eligible.has(w.id.split('/')[1]))continue;
     if(metric!=='compile'&&['compile-only','compile-and-instantiate'].includes(w.evidenceScope||''))continue;
     if(familyCorpora.has(w.id.split('/').slice(0,3).join('/'))&&!w.id.split('/')[3]?.startsWith('performance-'))continue;
    }
    const cell=cells[`${w.id}|${c.id}|${metric}`],v=cell?.v;
    if(cell?.st!=='ok'||v==null||!Number.isFinite(v)||v<0)continue;
    count++;sum+=v;if(v>0)logs+=Math.log(v);else zero=true;
   }
   values[metric]=count?(average==='mean'?sum/count:zero?0:Math.exp(logs/count)):null;
  }
  if(features){const total=suites?.reduce((n,f)=>n+f.total,0)||0;values.pass=total?100*suites!.reduce((n,f)=>n+f.pass,0)/total:null;}
  else values.pass=workloads.length?100*workloads.filter(w=>cells[`${w.id}|${c.id}|steady`]?.st==='ok').length/workloads.length:null;
  return {id:c.id,name:`${c.rt} ${c.be} ${c.label||''} ${host.configurations[c.id]?.version||''}`,values};
 });
}
