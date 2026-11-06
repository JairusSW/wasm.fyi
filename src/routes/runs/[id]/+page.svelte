<script lang="ts">
 import {onMount} from 'svelte';
 import {fmtU} from '$lib/format';
 import RunLocally from '$lib/components/RunLocally.svelte';
 let {data}=$props();
 type Item={engine:string;version:string;workload:string;artifact:string;contract:string;phase:string;status:string;latencyNs:number|null;rssBytes:number|null;codeBytes:number|null;observation:string;platform:string;capturedAt:string};
 type Report={run:{id:string;status:string;created:string;completed:number;error?:string};plan:{host:{cpu:string;arch:string};engines:{id:string;engine:string;repository:string;source:{revision:string;base:string;digest:string;local?:boolean;tag?:string}}[]};items:Item[]};
 let report=$state<Report|null>(null),error=$state(''),selected=$state<Item|null>(null),samples=$state<number[]>([]),loading=$state(false);
 const groups=$derived.by(()=>{const rows=new Map<string,Item[]>();for(const item of report?.items||[]){const key=item.engine+'|'+item.workload;rows.set(key,[...(rows.get(key)||[]),item])}return [...rows.values()]});
 const phases=['compile','instantiate','first-call','steady'];
 onMount(()=>{const abort=new AbortController();let timer:ReturnType<typeof setTimeout>;async function refresh(){try{const r=await fetch('/api/local/runs/'+encodeURIComponent(data.runId),{signal:abort.signal});if(!r.ok)throw Error(r.status===404?'This run is available only on the local website that captured it.':'Could not load local run.');report=await r.json();if(report?.run.status==='running'||report?.run.status==='planned')timer=setTimeout(refresh,2000)}catch(e){if(!abort.signal.aborted)error=String(e)}}void refresh();return()=>{abort.abort();clearTimeout(timer)}});
 async function inspect(item:Item){selected=item;samples=[];loading=true;try{const r=await fetch('/api/observation?'+new URLSearchParams({platform:item.platform,id:item.observation}));if(!r.ok)throw Error('Samples unavailable');const result=await r.json();if(selected===item)samples=result.samplesNs||[]}catch(e){error=String(e)}finally{loading=false}}
 const status=(value:Item|undefined)=>value?.status==='unsupported'?'⊘':value?.status==='failed'?'✕':'—';
</script>
<svelte:head><title>{data.runId} · Local run · wasm.fyi</title></svelte:head>
<section class="local-run">
 <h1>Local benchmark run</h1>
 <p class="mono">{data.runId}</p>
 {#if error}<p role="alert">{error}</p>{/if}
 {#if report}
  <p>{report.plan.host.cpu} · {report.plan.host.arch} · {report.run.status} · {report.run.completed} captured workloads</p>
  <p>Exact run membership is preserved. Timings are for this machine; no production data is imported.</p>
  {#if report.run.error}<p role="alert">{report.run.error}</p>{/if}
  <div class="scroll"><table><thead><tr><th>Workload</th><th>Engine</th>{#each phases as phase}<th>{phase}</th>{/each}<th>Peak RSS</th><th>Native code</th></tr></thead><tbody>
   {#each groups as row (row[0].engine+'|'+row[0].workload)}
    <tr><th>{row[0].workload}</th><td>{row[0].engine}<br/><small>{row[0].version}</small></td>
     {#each phases as phase}{@const item=row.find(x=>x.phase===phase)}<td>{#if item?.latencyNs!=null}<button onclick={()=>inspect(item)}>{fmtU(item.latencyNs/1e6,'ms')}</button>{:else}{status(item)}{/if}</td>{/each}
     <td>{row.some(x=>x.rssBytes!=null)?fmtU(Math.max(...row.map(x=>x.rssBytes||0))/(1024**2),'MiB'):'—'}</td>
     <td>{row.some(x=>x.codeBytes!=null)?fmtU(Math.max(...row.map(x=>x.codeBytes||0))/1024,'KiB'):'—'}</td>
    </tr>
   {/each}
  </tbody></table></div>
  {#if selected}
   {@const engine=report.plan.engines.find(e=>e.engine===selected?.engine)}
   <section aria-label="Selected result"><h2>{selected.workload} · {selected.phase}</h2>
    {#if engine}<RunLocally workloads={[selected.workload]} engines={[{engine:engine.engine,source:{repository:engine.source.local?'local:'+engine.repository:engine.repository,revision:engine.source.local?engine.source.base:engine.source.revision,ref:engine.source.local?'local:'+engine.source.base+':'+engine.source.digest:engine.source.tag||'main',kind:engine.source.local?'current':'snapshot',asOf:report.run.created}}]} artifact={selected.artifact} contract={selected.contract} pinned />{/if}
    {#if loading}<p>Loading samples…</p>{:else}<p>Ordered samples (ns): <span class="mono">{samples.join(', ')||'Not measured'}</span></p>{/if}
   </section>
  {/if}
 {:else if !error}<p>Loading local run…</p>{/if}
</section>
<style>
 .local-run{max-width:1400px;margin:auto;padding:2rem}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{text-align:left;padding:.65rem;border:1px solid var(--line)}button{color:var(--fg);background:none;border:0;text-decoration:underline;cursor:pointer}small{color:var(--fg3)}section[aria-label]{padding-top:2rem}
</style>
