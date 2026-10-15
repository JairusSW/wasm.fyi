<script lang="ts">
 import type {Component} from 'svelte';
 import {ui} from '$lib/state.svelte';
 import {loadCellSamples} from '$lib/api/controller.svelte';
 let Drawer=$state<Component|null>(null);
 let loading:Promise<void>|undefined;
 let error=$state('');
 const warm=()=>loading??=import('./Drawer.svelte').then(module=>{Drawer=module.default}).catch(reason=>{loading=undefined;error=String(reason)});
 function intent(event:Event){if(event.target instanceof Element&&event.target.closest('.cellbtn'))void warm()}
 $effect(()=>{
  const selected=ui.drawer;if(!selected)return;
  void warm();
  if(selected.type!=='cell')return;
  const abort=new AbortController();
  void loadCellSamples(ui.machine,ui.snap,selected.b,selected.c,selected.m,abort.signal).catch(()=>{});
  return ()=>abort.abort();
 });
</script>
<svelte:document onpointerover={intent} onfocusin={intent} />
<svelte:window onkeydown={event=>{if(!Drawer&&event.key==='Escape')ui.drawer=null}} />
{#if Drawer}<Drawer />{:else if ui.drawer}
 <div class="pending" role="dialog" tabindex="-1" aria-label="Measurement details" aria-modal="false">
  <button class="btn" onclick={()=>ui.drawer=null} aria-label="Close details">Close ×</button>
  {#if error}<p>Could not load details.</p><button class="btn" onclick={()=>{error='';void warm()}}>Retry</button>{:else}<p aria-live="polite">Loading details…</p>{/if}
 </div>
{/if}
<style>
 .pending{position:fixed;z-index:90;inset:0 0 0 auto;width:min(600px,100vw);padding:24px;background:var(--bg);border-left:1px solid var(--line)}
 p{margin-top:24px;color:var(--fg3)}
</style>
