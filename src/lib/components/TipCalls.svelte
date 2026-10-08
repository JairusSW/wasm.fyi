<script lang="ts">
	import { fmtU } from '$lib/format';

	let { label, value, note, color }: { label:string;value:number|null;note:string;color:string } = $props();
</script>
<span class="calls">
 <span class="lbl"><span style:color>{label}</span><span class="mono">{value==null?'not measured':fmtU(value,'ms')}</span></span>
 <span>{note}</span>
</span>

<style>
	.calls {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 10px;
		color: var(--fg3);
	}
	.lbl {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		white-space: nowrap;
	}
</style>
