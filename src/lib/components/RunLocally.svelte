<script lang="ts">
 import {reproductionCommand,type ReproduceEngine} from '$lib/reproduce';
 let {engines,workloads,artifact,contract,pinned=false,compatibility=false}:{engines:ReproduceEngine[];workloads:string[];artifact?:string;contract?:string;pinned?:boolean;compatibility?:boolean}=$props();
 let copied=$state(false),opened=$state(false),error=$state('');
 const result=$derived.by(()=>{try{return {...reproductionCommand({engines,workloads,artifact,contract,pinned,compatibility}),error:''}}catch(e){return {command:'',note:'',error:String(e instanceof Error?e.message:e)}}});
 async function copy(){opened=true;error='';copied=false;try{await navigator.clipboard.writeText(result.command);copied=true}catch{error='Clipboard access was denied. Select and copy the command below.'}}
</script>
<div class="reproduce">
 <button class="run-local" onclick={copy} disabled={!result.command} title={result.error||'Copy a command to run this locally'}>{copied?'Copied command':'Run locally'}</button>
 {#if result.error}<span class="small fg3">{result.error}</span>{/if}
 {#if opened&&result.command}<div class="repro-command"><code>{result.command}</code><p class="small fg3">{result.note} <a href="https://github.com/JairusSW/wasm.fyi#local-cli">Install the CLI</a></p>{#if error}<p role="alert">{error}</p>{/if}</div>{/if}
</div>
<style>
 .reproduce{display:inline-block;max-width:100%}.run-local{border:1px solid var(--line);border-radius:4px;padding:.45rem .7rem;background:var(--bg2);color:var(--fg);cursor:pointer}.run-local:disabled{opacity:.5;cursor:default}.repro-command{max-width:60rem;padding:.75rem 0}code{display:block;white-space:pre-wrap;overflow-wrap:anywhere;user-select:all;font-family:var(--mono)}p{margin-top:.4rem}
</style>
