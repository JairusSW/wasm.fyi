<script lang="ts">
 import {onMount,untrack} from 'svelte';
 import {ui} from '$lib/state.svelte';
 import {fmtU} from '$lib/format';
 import {latencyAverages,engineVersions,selectEngineVersions,codeSizeLabel,type LatencyPage,type LatencyRow,type LatencyPhase,type LatencyPlatform} from '$lib/latency';
 import Seg from '../Seg.svelte';
 const phases=[['compile','Compilation'],['instantiate','Instantiation'],['first-call','First call'],['steady','Steady execution']] as const;
 const metricPhase={compile:'compile',inst:'instantiate',first:'first-call',steady:'steady'} as const;
 const phase=$derived(metricPhase[ui.metric as keyof typeof metricPhase]||'steady');
 let platforms=$state<LatencyPlatform[]>([]),rows=$state<LatencyRow[]>([]),platform=$state(''),loading=$state(true),error=$state('');
 let selectedVersions=$state<Record<string,string>>({});
 let hidden=$state<string[]>([]),mounted=$state(false),generation=0;
 let controller:AbortController|undefined;
 const engines=$derived([...new Set(rows.map(r=>r.engine))].sort());
 const shown=$derived(engines.filter(e=>!hidden.includes(e)));
 const machine=$derived(platforms.find(p=>p.id===platform));
 const versions=$derived(engineVersions(rows));
 const selectedRows=$derived(selectEngineVersions(rows,selectedVersions));
 const averages=$derived(latencyAverages(selectedRows,shown,ui.cohortMode));
 const workloads=$derived([...new Set(rows.filter(r=>r.workload.toLowerCase().includes(ui.q.toLowerCase())||r.wasm.toLowerCase().includes(ui.q.toLowerCase())).map(r=>r.workload))].sort());
 const cells=$derived(new Map(selectedRows.map(r=>[r.workload+'|'+r.engine,r])));
 const version=(engine:string)=>{const row=selectedRows.find(r=>r.engine===engine);return row?row.version+' · '+row.backend:''};
 function selectVersion(engine:string,key:string){selectedVersions={...selectedVersions,[engine]:key}}
 function setPhase(value:string){ui.metric=({compile:'compile',instantiate:'inst','first-call':'first',steady:'steady'} as const)[value as LatencyPhase]}
 function toggle(engine:string){if(hidden.includes(engine))hidden=hidden.filter(e=>e!==engine);else if(shown.length>1)hidden=[...hidden,engine]}
 function bytes(value:number|null|undefined,status:string|undefined){return value!=null?fmtU(value/1024,'KiB'):status||'not captured'}
 function value(row:LatencyRow|undefined){return row?.latencyStatus==='ok'&&row.latencyNs!=null?fmtU(row.latencyNs/1e6,'ms'):row?.latencyStatus||'not measured'}
 async function load(selected:string,current:LatencyPhase){
  controller?.abort();controller=new AbortController();const signal=controller.signal;
  const token=++generation;loading=rows.length===0;error='';
  try {
   const catalogResponse=await fetch('/api/platforms',{signal});
   if(!catalogResponse.ok)throw Error(`Could not load platforms (${catalogResponse.status})`);
   const catalog=await catalogResponse.json() as {revision:string;items:LatencyPlatform[]};
   if(token!==generation)return;
   platforms=catalog.items;
   if(!platforms.length){rows=[];platform='';return}
   if(!selected||!platforms.some(p=>p.id===selected)){selected=platforms[0].id;platform=selected}
   for(let retry=0;retry<3;retry++) {
    let cursor:string|null=null,items:LatencyRow[]=[],restart=false;
    do {
     const query=new URLSearchParams({limit:'1000',phase:current,platform:selected,...(cursor?{cursor}:{})});
     const response=await fetch('/api/benchmarks?'+query,{signal});
     if(response.status===409){restart=true;break}
     if(!response.ok)throw Error(`Could not load benchmarks (${response.status})`);
     const data=await response.json() as LatencyPage;
     if(token!==generation)return;
     cursor=data.nextCursor;items.push(...data.items);
     if(items.length>100000)throw Error('Benchmark selection is too large');
    }while(cursor);
    if(!restart){rows=items;return}
   }
   throw Error('Results are updating. Please retry.');
  }catch(e){if(token===generation)error=e instanceof Error?e.message:String(e)}finally{if(token===generation)loading=false}
 }
 onMount(()=>{mounted=true;const timer=setInterval(()=>{if(!document.hidden)void load(platform,phase)},30000);return()=>{generation++;controller?.abort();clearInterval(timer)}});
 $effect(()=>{const selected=platform,current=phase;if(mounted)untrack(()=>void load(selected,current))});
</script>

<svelte:head><title>Benchmarks · wasm.fyi</title></svelte:head>
<div class="stack">
 <h1>Benchmarks</h1>
 <div class="controls">
  <select bind:value={platform} aria-label="Platform">{#each platforms as p}<option value={p.id}>{p.cpu} · {p.os}/{p.arch}</option>{/each}</select>
  <Seg options={phases.map(([id,label])=>[id,label])} value={phase} onselect={setPhase} label="Latency phase" />
  <Seg options={[['per-engine','Passed per engine'],['shared','Passed on all engines']]} value={ui.cohortMode} onselect={v=>ui.cohortMode=v as 'shared'|'per-engine'} label="Average corpus selection" />
 </div>
 {#if machine}<p class="small fg3">{machine.os}/{machine.arch} · {machine.cpu} · {machine.cores} logical cores{machine.memoryBytes?' · '+Math.round(machine.memoryBytes/1024**3)+' GiB RAM':''} · {machine.kernel}</p>{/if}
 <div class="controls" role="group" aria-label="Engines shown">{#each engines as engine}<button class="btn-small" aria-pressed={!hidden.includes(engine)} onclick={()=>toggle(engine)}>{engine}</button>{/each}</div>
 {#if error}<p role="alert">{error}</p><button class="btn-small" onclick={()=>load(platform,phase)}>Retry</button>{/if}
 {#if loading}<p role="status">Loading latencies…</p>{:else if !rows.length&&!error}<p>No benchmark results have been captured yet.</p>{:else}
 <p class="small fg3">Median latency · lower is better. Averages use the geometric mean of passed workloads for the selected engine versions.</p>
 <div class="table-scroll" id="workloads"><table>
  <thead><tr><th>Wasm workload</th>{#each shown as engine}<th>{engine}<span class="version" title={version(engine)}>{version(engine)}</span>{#if (versions.get(engine)?.length||0)>1}<select class="version-picker" aria-label={engine+' version'} value={(versions.get(engine)||[]).some(c=>c.key===selectedVersions[engine])?selectedVersions[engine]:''} onchange={e=>selectVersion(engine,e.currentTarget.value)}><option value="">Latest measured version</option>{#each versions.get(engine)||[] as config}<option value={config.key}>{config.version} · {config.backend}</option>{/each}</select>{/if}</th>{/each}</tr></thead>
  <tbody>
   <tr class="average"><th>Average</th>{#each averages as a}<td>{a.value==null?'not measured':fmtU(a.value/1e6,'ms')}<span class="version">{a.count} passed workloads</span></td>{/each}</tr>
   {#each workloads as workload}
    {@const sample=rows.find(r=>r.workload===workload)}
    <tr><th>{workload}<span class="version">{sample?.wasm}</span></th>{#each shown as engine}{@const cell=cells.get(workload+'|'+engine)}<td>{value(cell)}<span class="version">Peak RSS: {bytes(cell?.peakRssBytes,cell?.memoryStatus)}</span><span class="version">{codeSizeLabel(cell?.codeKind)}: {bytes(cell?.codeBytes,cell?.codeStatus)}</span></td>{/each}</tr>
   {/each}
  </tbody>
 </table></div>
 {/if}
</div>
<style>
 .version-picker{display:block;max-width:220px;margin-top:6px;font-size:11px}h1{font-size:20px}.controls{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.table-scroll{overflow:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;white-space:nowrap;padding:10px 12px;border-bottom:1px solid var(--bd)}th{font-weight:500}td{font-family:var(--mono);font-variant-numeric:tabular-nums}.version{display:block;max-width:220px;overflow:hidden;text-overflow:ellipsis;font:11px var(--mono);color:var(--fg3);margin-top:3px}.average{background:var(--bg2)}button[aria-pressed=false]{opacity:.45}select{max-width:100%;padding:6px;font:inherit;background:var(--bg);color:var(--fg);border:1px solid var(--bd);border-radius:4px}
</style>
