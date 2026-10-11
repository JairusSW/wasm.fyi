<script lang="ts">
 import {ST} from '$lib/data/status';
 let {note=''}:{note?:string}=$props();
</script>
<div class="status-legend small" aria-label="Result status legend">
 {#each Object.values(ST) as [glyph,label,color] (label)}<span style:color={color}>{glyph} {label}</span>{/each}
 {#if note}<span class="fg3">{note}</span>{/if}
</div>
<style>
 .status-legend{display:flex;flex-wrap:wrap;align-items:center;gap:4px 14px;font-size:12px;}
 @media(max-width:720px){.status-legend{gap:4px 12px;}}
</style>
