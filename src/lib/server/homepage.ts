import {bakePageSeed} from '$lib/api/controller.svelte';
import {CFG} from '$lib/data/runtimes';
import {absOf,combinedLatency,compileExcluded,isVisible,totalWorkloads} from '$lib/model';
import {ui} from '$lib/state.svelte';
import {viewData} from '$lib/view-data';
import {summarizeFeatures} from '$lib/feature-summary';
import {runtimeFilterRows} from '$lib/runtime-filter-data';
import {HOME_METRICS,type HomeMetric,type Homepage,type HomeMachine} from '$lib/homepage';
export async function bakeHomepage(origin:string):Promise<Homepage>{
 const out:Homepage={schema:1,revision:'',samples:{all:0,latest:0},machines:{}};
 for(const machine of ['m1','m2','m3'] as const){
  // Only runtimes that run every main-corpus workload correctly are ranked. The
  // homepage seed carries overviews only, so read pass rates from the benchmarks seed.
  const benchSeed=await bakePageSeed(origin,'/benchmarks/',machine);
  const complete=new Set(benchSeed.machine===machine?runtimeFilterRows(viewData,machine,CFG,false,'mean').filter(r=>r.values.pass===100).map(r=>r.id):[]);
  const seed=await bakePageSeed(origin,'/',machine);if(seed.machine!==machine)continue;
  const scope=ui.scope;
  const metrics={} as HomeMachine['metrics'];
  for(const metric of Object.keys(HOME_METRICS) as HomeMetric[]){
   const rows=CFG.filter(c=>viewData.applicationConfigurations.includes(c.id)&&complete.has(c.id)&&isVisible(scope,c)).map(c=>{
    const v=metric==='e2e'?combinedLatency(scope,c,[0,1,2,3])?.total:metric==='compile'&&compileExcluded(scope,c,'compile')?null:absOf(scope,HOME_METRICS[metric].group,c.id,metric==='compile'?0:metric==='inst'?1:3)?.v;
    return {c:{id:c.id,rt:c.rt,be:c.be,col:c.col,hollow:c.hollow},v};
   }).filter((r):r is {c:typeof r.c;v:number}=>r.v!=null&&Number.isFinite(r.v)&&r.v>0).sort((a,b)=>a.v-b.v);
   metrics[metric]={total:rows.length,rows:rows.slice(0,10).map(r=>({...r,bar:rows[0].v/r.v*100}))};
  }
  const updated=Object.values(viewData.reports).map(r=>r.created.slice(0,10)).sort().at(-1)??null;
  const host=viewData.hosts[machine].label,workloads=totalWorkloads();
  out.revision=seed.summary.revision;out.samples={all:viewData.statistics.allTimingSamples??0,latest:viewData.statistics.timingSamples??0};
  const featureSeed=await bakePageSeed(origin,'/features/',machine);
  out.machines[machine]={host,updated,workloads,metrics,features:featureSeed.machine===machine?summarizeFeatures(ui.scope):null};
 }
 ui.machine='m1';
 return out;
}
