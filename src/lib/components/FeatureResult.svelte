<script lang="ts">
  import PlugIcon from './PlugIcon.svelte';
  let {passed,total,failed=0,skipped=0,missing=0,measured=true,plugin=false,flagged=false,label,tooltip,href,onselect}:{
    passed:number;total:number;failed?:number;skipped?:number;missing?:number;measured?:boolean;
    plugin?:boolean;flagged?:boolean;label:string;tooltip:string;href?:string;onselect?:()=>void;
  }=$props();
</script>

{#snippet contents()}
  <span class="count"><span class="marker">{#if plugin}<PlugIcon />{:else if flagged}⚑{/if}</span><span>{measured?`${passed}/${total}`:'—'}</span><span></span></span>
  <span class="bar" aria-hidden="true">
    {#if measured && total>0}
      <span class="pass" style:width={`${100*passed/total}%`}></span><span class="fail" style:width={`${100*failed/total}%`}></span><span class="skip" style:width={`${100*skipped/total}%`}></span><span class="missing" style:width={`${100*missing/total}%`}></span>
    {/if}
  </span>
{/snippet}

{#if href}
  <a class="feature-result mono" {href} aria-label={label} data-tip-summary={tooltip}>{@render contents()}</a>
{:else}
  <button class="feature-result mono" type="button" aria-label={label} data-tip-summary={tooltip} onclick={onselect}>{@render contents()}</button>
{/if}

<style>
  .feature-result { display:flex;flex-direction:column;gap:3px;width:100%;box-sizing:border-box;padding:2px 4px;color:var(--fg);font-size:11px;line-height:16px;white-space:nowrap;text-decoration:none; }
  .feature-result:hover,.feature-result:focus-visible { outline:1px solid var(--line2); }
  .count { display:grid;grid-template-columns:12px 1fr 12px;align-items:center;text-align:center;gap:2px; }
  .marker { display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--fg3); }
  .bar { display:flex;height:3px;width:100%;background:var(--line);overflow:hidden; }
  .pass { background:var(--st-pass); }.fail { background:var(--st-fail); }.skip { background:var(--st-skip); }.missing { background:var(--line2); }
</style>
