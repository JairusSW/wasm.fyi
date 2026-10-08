<script lang="ts">
 import {currentClient} from '$lib/api/controller.svelte';
 import type {NativeFunctionPage,NativeDisassemblyPage,WireRecord} from '$lib/api/types';
 let {artifact}:{artifact:string}=$props();
 let descriptor=$state<WireRecord|null>(null),functions=$state<NativeFunctionPage|null>(null),listing=$state<NativeDisassemblyPage|null>(null);
 let error=$state(''),loading=$state(false),start=$state(0),ordinal=$state<number|null>(null);
 const content=$derived(descriptor?.data.content as {status:string;bytes?:number;sha256?:string}|undefined);
 const inspection=$derived(descriptor?.data.inspection as {status:string;disassembly?:{status:string;reason?:string}}|undefined);
 $effect(()=>{
  const client=currentClient();if(!client)return;const abort=new AbortController();const selected=artifact;
  descriptor=null;functions=null;listing=null;start=0;error='';loading=true;
  void client.descriptor('artifacts',selected,abort.signal).then(page=>{descriptor=page.record}).catch(e=>{if(!abort.signal.aborted)error=String(e)}).finally(()=>{if(!abort.signal.aborted)loading=false});
  return ()=>abort.abort();
 });
 async function loadFunctions(cursor=''){
  const client=currentClient();if(!client)return;loading=true;error='';
  try{const page=await client.client.load<NativeFunctionPage>(`artifacts/${artifact}/functions`,{limit:50,...(cursor?{cursor}:{})});start=cursor?start+(functions?.items.length||0):0;functions=page;listing=null}catch(e){error=String(e)}finally{loading=false}
 }
 async function loadListing(index:number,cursor=''){
  const client=currentClient();if(!client)return;loading=true;error='';ordinal=index;
  try{listing=await client.client.load<NativeDisassemblyPage>(`artifacts/${artifact}/disassembly`,{function:index,limit:100,...(cursor?{cursor}:{})})}catch(e){error=String(e)}finally{loading=false}
 }
</script>
<div class="panel">
 {#if loading}<p role="status">Loading selected inspection…</p>{/if}
 {#if error}<p role="alert">{error}</p>{/if}
 {#if descriptor}
  <p class="small">Raw native bytes: {content?.status||'unavailable'} · Function inspection: {inspection?.status||'unavailable'}</p>
  {#if content?.status==='available'}<a class="link" href={currentClient()?.url(`artifacts/${artifact}/content`,{download:1})}>Download original native bytes ({content.bytes} bytes)</a>{/if}
  {#if inspection?.status==='available'}
   <button class="btn-small" disabled={loading} onclick={()=>loadFunctions()}>Load function index</button>
  {/if}
  {#if functions}
   <table class="mx"><thead><tr><th>Function</th><th>Offset</th><th>Bytes</th><th>Tier</th><th></th></tr></thead><tbody>
    {#each functions.items as fn,index}<tr><td class="mono">{fn.name||`Wasm function ${fn.wasm_index}`}</td><td>{fn.offset}</td><td>{fn.length}</td><td>{fn.tier}</td><td>{#if fn.disassembly}<button class="btn-small" disabled={loading} onclick={()=>loadListing(start+index)}>Disassembly</button>{:else}<span class="small fg3">not exported</span>{/if}</td></tr>{/each}
   </tbody></table>
   <p class="small">{start+1}–{start+functions.items.length} of {functions.total} functions</p>
   {#if functions.nextCursor}<button class="btn-small" disabled={loading} onclick={()=>loadFunctions(functions!.nextCursor)}>Next functions</button>{/if}
  {/if}
  {#if listing}
   <p class="small">{listing.window.interpretation}</p><pre class="mono" style="overflow:auto;max-height:30rem">{listing.window.items.join('\n')}</pre>
   {#if listing.nextCursor}<button class="btn-small" disabled={loading} onclick={()=>loadListing(ordinal!,listing!.nextCursor)}>Next instructions</button>{/if}
  {/if}
 {/if}
</div>
