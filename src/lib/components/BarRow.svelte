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
		valueClass = 'small fg2',
		from = '0%',
		center = false
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
		/** Left offset of the bar, for bars that diverge from a midline. */
		from?: string;
		/** Draw a midline at 50% (diverging charts). */
		center?: boolean;
	} = $props();
</script>

<div class="bar-row" style:grid-template-columns={cols}>
	<span class="lab"><RtLabel {c} /></span>
	<span class="mid" class:center>
		{#if ok}
			<span class="bar" style:margin-left={from} style:width={w} style:background={c.col}></span>
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
	.mid.center {
		position: relative;
	}
	.mid.center::before {
		content: '';
		position: absolute;
		left: 50%;
		top: -3px;
		bottom: -3px;
		border-left: 1px dashed var(--line2);
	}
</style>
