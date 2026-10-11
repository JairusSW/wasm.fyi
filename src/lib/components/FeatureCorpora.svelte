<script lang="ts">
 import type {CfgId} from '$lib/data/types';
 import {featureContracts} from '$lib/model';
 import {contractCohort} from '$lib/feature-values';
 import {viewData} from '$lib/view-data';
 import {ui} from '$lib/state.svelte';
 import {fmtU,fmtAverage} from '$lib/format';
 import {ST} from '$lib/data/status';
 import {heatCount,heatField} from '$lib/heat';
 let {family,ids,mode,metric='steady'}:{family:string;ids:CfgId[];mode:'support'|'perf';metric?:'steady'|'compile'|'rss'}=$props();
 const groups=$derived.by(()=>{
  const contracts=featureContracts(family);
  return [...new Set(contracts.map(w=>w.id.split('/')[2]))].map(name=>{
   const all=contracts.filter(w=>w.id.split('/')[2]===name);
   const eligible=all.filter(w=>metric==='compile'||!['compile-only','compile-and-instantiate'].includes(w.evidenceScope||''));
   const performance=eligible.filter(w=>w.id.split('/')[3]?.startsWith('performance-'));
   const measured=performance.length?performance:eligible;
   const comparison=contractCohort(ui.scope,measured,ids,metric);
   const cells=ids.map((id,k)=>{
    if(mode==='support'){
     const versions=viewData.featureVersions[ui.scope.machine].filter(v=>v.id===viewData.configurations[id]&&v.features.some(f=>f.id===family&&f.total>0));
     const version=versions.find(v=>v.channel==='stable')||versions.find(v=>v.channel==='development');
     const results=version?.features.find(f=>f.id===family)?.contracts.filter(c=>c.workload.split('/')[2]===name)||[];
     const passed=results.filter(c=>c.status==='passed').length,failed=results.filter(c=>c.status==='failed').length;
     const status=failed?ST.failed:results.length?ST.unsupported:ST.nm;
     return {text:passed?`${passed}/${results.length}`:status[0],sub:'',bg:passed?heatCount(1-passed/results.length):'transparent',color:passed?'var(--fg)':status[2],value:null,workload:all[0]?.id,channel:version?.channel||'stable',tip:results.length?`${passed} passed · ${failed} failed · ${results.length-passed-failed} unsupported`:'Not collected'};
    }
    const value=comparison.values[k],status=ST[comparison.statuses[k]],count=comparison.cohorts[k].length;
    return {text:value!=null?(count>1?fmtAverage:fmtU)(value,metric==='rss'?'MiB':'ms'):status[0],sub:'',bg:'transparent',color:value!=null?'var(--fg)':status[2],value,workload:comparison.cohorts[k][0]?.id||measured[0]?.id,channel:'stable' as const,tip:value!=null?`${ui.average==='mean'?'Arithmetic mean':'Geometric mean'} · ${count} measured contracts · ${ui.cohortMode==='shared'?'passed on all engines':'passed per engine'}`:status[1]};
   });
   const min=Math.min(...cells.flatMap(c=>c.value!=null?[c.value]:[]));
   return {name,label:name.replace(/-/g,' '),contracts:mode==='support'?all.length:measured.length,cells:cells.map((c,k)=>({...c,bg:c.value!=null?heatField(cells.map(x=>x.value),k):c.bg,lowest:c.value!=null&&c.value===min}))};
  });
 });
</script>

{#each groups as group (group.name)}
 <tr class="corpus-row">
  <td class="stick corpus-name"><span>{group.label}</span><span class="mono micro fg3">{group.contracts} contract{group.contracts===1?'':'s'}</span></td>
  {#each group.cells as cell,k (ids[k])}
   <td class="p0" style:background={cell.bg}>
    <button class="cellbtn corpus-cell" data-tip={cell.tip} style:color={cell.color} style:font-weight={cell.lowest?600:400}
     onclick={()=>{
      if(mode==='support')ui.drawer={type:'support',fam:family,c:ids[k],channel:cell.channel,peers:ids};
      else if(cell.workload)ui.drawer={type:'cell',b:cell.workload,c:ids[k],m:metric,cf:1};
     }}><span class="mono s12 nowrap">{cell.text}</span></button>
   </td>
  {/each}
 </tr>
{/each}

<style>
 .corpus-name{padding:3px 12px 3px 34px;background:var(--bg);font-size:12px;}
 .corpus-name span{display:block;}
 .corpus-cell{display:flex;align-items:center;justify-content:flex-end;min-height:28px;padding:3px 10px;color:var(--fg);}
</style>
