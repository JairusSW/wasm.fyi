<script lang="ts">
	import type { Cfg } from '$lib/data/types';
	import RtLabel from './RtLabel.svelte';

	/** Runtime · horizontal bar · value. When `ok` is false, `status` replaces the bar. */
	let {
		c,
		ok = true,
		w,
		text,
		status = '',
		statusColor = 'var(--fg3)',
		note = '',
		cols = '140px 1fr 120px',
		valueClass = 'small fg2'
	}: {
		c: Cfg;
		ok?: boolean;
		w: string;
		text: string;
		status?: string;
		statusColor?: string;
		note?: string;
		cols?: string;
		valueClass?: string;
	} = $props();
</script>

<div class="bar-row" style:grid-template-columns={cols}>
	<span class="lab"><RtLabel {c} /></span>
	<span class="mid">
		{#if ok}
			<span class="bar" style:width={w} style:background={c.col}></span>
		{:else}
			<span class="small" style:color={statusColor}>{status}</span>
		{/if}
		{#if note}<span class="micro fg3">{note}</span>{/if}
	</span>
	<span class="mono r {valueClass}">{ok ? text : ''}</span>
</div>

<style>
	.lab {
		overflow: hidden;
		display: flex;
	}
	.mid {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 1px;
		min-width: 0;
	}
	.bar {
		display: block;
	}
</style>
