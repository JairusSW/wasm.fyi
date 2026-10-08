<script lang="ts">
  import {loadFeatures} from '$lib/api/controller.svelte';
 import {ui} from '$lib/state.svelte';
 import { tick,untrack } from 'svelte';
  import { benchHref, siteHref } from '$lib/links';
  import { viewData } from '$lib/view-data';
  import type { FeatureTrack } from '$lib/support';
  let {selection,onclose}:{selection:{feature:string;engine:string;track:FeatureTrack}|null;onclose:()=>void}=$props();
  let dialog:HTMLDialogElement;
  let active=$state('');
  $effect(()=>{
    active='';
    if(selection)untrack(()=>{for(const configuration of selection.track.configurations){const identity=viewData.featureVersions[ui.machine].find(v=>v.id===configuration.id&&v.version===configuration.version)?.identity;if(identity)void loadFeatures({machine:ui.machine,snapshot:ui.snap,metric:ui.metric,hide:{...ui.scope.hide},baseline:ui.baseline,weighting:ui.weighting},selection.feature,identity)}});
    if(selection)void tick().then(()=>{if(selection && !dialog.open)dialog.showModal();});
    else if(dialog?.open)dialog.close();
  });
</script>

<dialog bind:this={dialog} onclose={onclose} aria-label="Feature corpus results">
  {#if selection}
    {@const track=selection.track}
    <header><div><h2>{selection.engine} · {selection.feature}</h2><div class="version">{track.channel==='stable'?'Published release':'Development build'} · {track.version || 'not collected'}</div></div><button onclick={()=>dialog.close()} aria-label="Close corpus results">✕</button></header>
    {#if !track.configurations.length}<p class="empty">No measured corpus results for this track on the selected host.</p>{/if}
    {#if track.configurations.length>1}
      <div class="backends" role="group" aria-label="Compiler backend">
        {#each track.configurations as c (c.id)}<button aria-pressed={c.id===(active || track.configurations[0].id)} onclick={()=>active=c.id}>{c.backend} <span class="mono">{c.pass}/{c.total}</span></button>{/each}
      </div>
    {/if}
    {#each track.configurations.filter(c=>c.id===(active || track.configurations[0]?.id)) as c (c.id)}
      <section>
        <div class="backend"><strong>{c.backend}</strong><span class="mono">{c.pass}/{c.total} passed</span></div>
        <div class="result-bar" aria-hidden="true"><span class="pass" style:width={`${c.pass/c.total*100}%`}></span><span class="fail" style:width={`${c.failed/c.total*100}%`}></span><span class="skip" style:width={`${c.skipped/c.total*100}%`}></span><span class="missing" style:width={`${c.missing/c.total*100}%`}></span></div>
        <div class="counts"><span class="passed">● {c.pass} passed</span><span class="failed">✕ {c.failed} failed</span><span>— {c.skipped} unsupported</span>{#if c.missing}<span>? {c.missing} uncollected</span>{/if}</div>
        <div class="micro fg3">Collected {c.collectedAt.slice(0,10)}{#if c.source} · <a href={c.source}>Build source</a>{/if}</div>
        <div class="contracts">
          {#each (viewData.featureVersions[ui.machine].find(v=>v.id===c.id&&v.version===c.version)?.features.find(f=>f.id===selection.feature)?.contracts||c.contracts) as contract (contract.workload)}
            {@const report=viewData.reports[contract.report]}
            <div class="contract">
              <span class:passed={contract.status==='passed'} class:failed={contract.status==='failed'} class="status">{contract.status==='passed'?'●':contract.status==='failed'?'✕':'—'} {contract.status}</span>
              <div><a href={benchHref(contract.workload)}>{contract.workload.split('/').slice(2).join(' / ')}</a><div class="micro fg3">{contract.scope}</div>
                {#if contract.reasons.length}<details><summary>Diagnostic</summary><pre>{contract.reasons.join('\n\n')}</pre></details>{/if}
              </div>
            </div>
          {/each}
        </div>
      </section>
    {/each}
    <footer>Each backend stands on its own. Compilation-only probes are separate from execution tests.</footer>
  {/if}
</dialog>

<style>
  dialog { box-sizing:border-box;margin:auto;width:min(650px,calc(100vw - 32px));max-height:85dvh;overflow:auto;background:var(--bg);color:var(--fg);border:1px solid var(--line2);padding:18px;box-shadow:var(--shadow-float); }
  dialog::backdrop { background:rgb(0 0 0 / .55); }
  header,.backend { display:flex;justify-content:space-between;gap:16px;align-items:baseline; }
  h2 { margin:0;font-size:16px; }
  .version { color:var(--fg3);font-size:11px;overflow-wrap:anywhere;margin-top:6px; }
  header button { padding:4px 8px;min-width:36px;min-height:36px;border:1px solid var(--line2);flex:none; }
  .backends { display:flex;gap:5px;flex-wrap:wrap;margin-top:15px; }
  .backends button { font-size:11px;border:1px solid var(--line2);padding:4px 6px;color:var(--fg3); }
  .backends button[aria-pressed="true"] { background:var(--line2);color:var(--fg); }
  section { margin-top:20px; }
  .backend { font-size:12px; }
  .result-bar { display:flex;height:5px;background:var(--line);margin:9px 0; }
  .pass { background:var(--st-pass); }.fail { background:var(--st-fail); }.skip { background:var(--st-skip); }.missing { background:var(--line2); }
  .counts { display:flex;flex-wrap:wrap;gap:12px;font-size:11px;margin-bottom:6px;color:var(--fg3); }
  .passed { color:var(--st-pass); }.failed { color:var(--st-fail); }
  .contracts { margin-top:10px;border-top:1px solid var(--line); }
  .contract { display:grid;grid-template-columns:90px 1fr auto;gap:10px;padding:8px 0;border-bottom:1px solid var(--line);font-size:12px; }
  .contract > div { min-width:0;overflow-wrap:anywhere; }
  .status { font-size:11px; }
  details { font-size:11px;margin-top:5px; }summary { color:var(--fg3);cursor:pointer; }
  pre { white-space:pre-wrap;overflow-wrap:anywhere;max-height:160px;overflow:auto;font-size:10px; }
  footer,.empty { font-size:11px;color:var(--fg3);margin-top:16px; }
  @media(max-width:480px) { .contract { grid-template-columns:70px 1fr; } }
</style>
