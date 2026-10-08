<script lang="ts">
 import {currentClient} from '$lib/api/controller.svelte';
 import type {ReportFilePage} from '$lib/api/types';
 let {report}:{report:string}=$props();
 let files=$state<ReportFilePage|null>(null),loading=$state(false),error=$state('');
 $effect(()=>{report;files=null;error=''});
 async function load(){const client=currentClient();if(!client)return;const selected=report;loading=true;error='';try{const result=await client.client.load<ReportFilePage>(`reports/${selected}/files`);if(selected===report)files=result}catch(e){if(selected===report)error=String(e)}finally{if(selected===report)loading=false}}
</script>
<button class="btn-small" disabled={loading} onclick={load}>{loading?'Loading file list…':'Show analytical exports and sealed report download'}</button>
{#if error}<p role="alert">{error}</p>{/if}
{#if files}
 {#if !files.items.length}<p class="small fg3">No downloadable originals are published for this report.</p>{/if}
 <ul>{#each files.items as file (file.id)}<li><a class="link" href={currentClient()?.url(`files/${file.id}/download`)}>{file.data.name}</a> <span class="small fg3">{(file.data.bytes/1024**2).toFixed(1)} MiB · explicit download</span></li>{/each}</ul>
{/if}
