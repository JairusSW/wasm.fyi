<script lang="ts">
 import {onDestroy} from 'svelte';
 import {ui} from '$lib/state.svelte';
 import {emptyRuntimeFilters, type FilterMetric, type RuntimeFilterRule} from '$lib/runtime-filters';
 const metrics:[FilterMetric,string][]=[['steady','Steady execution · ms'],['compile','Compilation · ms'],['inst','Instantiation · ms'],['first','First call · ms'],['rss','Peak RSS · MiB'],['code','Native code · KiB'],['pass','Pass rate · %']];
 const percentiles=[5,10,20,25,50,75,100];
 let search=$state(ui.runtimeFilters.name);
 let searchTimer:ReturnType<typeof setTimeout>|undefined;
 $effect(()=>{search=ui.runtimeFilters.name;clearTimeout(searchTimer)});
 onDestroy(()=>clearTimeout(searchTimer));
 function searchChanged(value:string){search=value;clearTimeout(searchTimer);searchTimer=setTimeout(()=>{ui.runtimeFilters={...ui.runtimeFilters,name:value}},250)}
 const count=$derived(ui.runtimeFilters.rules.length+(ui.runtimeFilters.name.trim()?1:0));
 function update(index:number,patch:Partial<RuntimeFilterRule>){ui.runtimeFilters={...ui.runtimeFilters,rules:ui.runtimeFilters.rules.map((r,i)=>i===index?{...r,...patch}:r)}}
 function add(){ui.runtimeFilters={...ui.runtimeFilters,rules:[...ui.runtimeFilters.rules,{metric:'steady',top:10,limit:null}]};ui.filterOpen=true}
</script>
<div class="filters">
 <div class="toolbar">
  <button class="btn-small" aria-expanded={ui.filterOpen} aria-controls="runtime-filter-panel" onclick={()=>ui.filterOpen=!ui.filterOpen}>Runtime filters{count?` · ${count}`:''} <span aria-hidden="true">{ui.filterOpen?'▴':'▾'}</span></button>
  {#if count}<span class="small fg3" role="status">{ui.filterMatches.size} runtimes match</span><button class="clear" onclick={()=>ui.runtimeFilters=emptyRuntimeFilters()}>Clear filters</button>{/if}
 </div>
 {#if ui.filterOpen}
 <div id="runtime-filter-panel" class="panel">
  <label class="search">Runtime name, backend or version<input type="search" placeholder="e.g. wago, wasmtime, llvm" value={search} oninput={e=>searchChanged(e.currentTarget.value.slice(0,200))} maxlength="200" /></label>
  {#each ui.runtimeFilters.rules as rule,i (i)}
   <div class="rule">
    <label>Metric<select aria-label={`Filter ${i+1} metric`} value={rule.metric} onchange={e=>update(i,{metric:e.currentTarget.value as FilterMetric,limit:null})}>{#each metrics as [id,label]}<option value={id}>{label}</option>{/each}</select></label>
    <label>Ranking<select aria-label={`Filter ${i+1} percentile`} value={rule.top} onchange={e=>update(i,{top:Number(e.currentTarget.value)})}>{#each percentiles as p}<option value={p}>{p===100?'All measured':`Top ${p}%`}</option>{/each}</select></label>
    <label>{rule.metric==='pass'?'Minimum pass rate (%)':'Maximum value'}<input aria-label={`Filter ${i+1} ${rule.metric==='pass'?'minimum':'maximum'}`} type="number" min="0" max={rule.metric==='pass'?100:undefined} step="any" placeholder="No limit" value={rule.limit??''} oninput={e=>{const v=e.currentTarget.valueAsNumber;update(i,{limit:Number.isFinite(v)?Math.max(0,rule.metric==='pass'?Math.min(100,v):v):null})}} /></label>
    <button class="clear remove" aria-label={`Remove filter ${i+1}`} onclick={()=>ui.runtimeFilters={...ui.runtimeFilters,rules:ui.runtimeFilters.rules.filter((_,k)=>k!==i)}}>Remove</button>
   </div>
  {/each}
  <div><button class="btn-small" onclick={add} disabled={ui.runtimeFilters.rules.length>=8}>+ Add metric filter</button></div>
  <p class="small fg3">Names match all typed words; commas separate alternatives. Metric rules must all match. Top percentages rank measured runtimes matching the name, chips, execution model and language; ties are included. Missing metrics do not match a metric rule.</p>
  <p class="small fg3">Ranks use latest {ui.filterFeatures?'feature':'main-corpus'} per-engine {ui.average==='mean'?'arithmetic means':'geometric means'} before runtime filtering. Shared-cohort comparisons are recalculated for the remaining engines. Pass rate always uses the full test set.</p>
  {#if count&&!ui.filterMatches.size}<p class="small">No runtimes match. Widen a rule or clear the filters.</p>{/if}
 </div>
 {/if}
</div>
<style>
 .filters{border-top:1px solid var(--line);padding-top:7px}
 .toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
 .panel{display:flex;flex-direction:column;gap:10px;padding:12px 0 4px;max-width:960px}
 label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--fg2);min-width:0}
 input,select{font:inherit;color:var(--fg);background:var(--bg);border:1px solid var(--line2);padding:6px 8px;min-width:0;border-radius:2px}
 input:focus-visible,select:focus-visible{outline:2px solid var(--fg3);outline-offset:2px}
 .search{max-width:440px}.rule{display:grid;grid-template-columns:2fr 1fr 1fr auto;align-items:end;gap:10px}
 .clear{font-size:12px;text-decoration:underline;color:var(--fg2)}.remove{padding:7px 0}p{margin:0;line-height:1.5}
 @media(max-width:720px){.rule{grid-template-columns:1fr 1fr}.search{max-width:none}.remove{justify-self:start}}
</style>
