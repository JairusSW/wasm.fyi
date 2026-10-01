<script lang="ts">
	import type { Cfg } from '$lib/data/types';
	import { ui } from '$lib/state.svelte';
	import Swatch from './Swatch.svelte';

	/**
	 * Runtime name with its backend. With `profile`, the label is a button that
	 * opens the runtime profile drawer.
	 */
	let {
		c,
		profile = false,
		mono = false,
		ver = false,
		bold = false,
		size = 8,
		tip
	}: { c: Cfg; profile?: boolean; mono?: boolean; ver?: boolean; bold?: boolean; size?: number; tip?: string } = $props();

	const bg = $derived(c.hollow ? 'transparent' : c.col);
	const defaultTip = $derived(`${c.rt} ${c.ver} · ${c.be}\n${c.kind}\nClick to open runtime profile`);
</script>

{#if profile}
	<button class="rl" onclick={() => ui.openProfile(c.rt)} data-tip={tip ?? defaultTip}>
		<Swatch color={c.col} {bg} {size} />
		<span class:bold>{c.rt}</span>
		<span class="be" class:mono>{ver ? c.ver + ' · ' : ''}{c.be}</span>
	</button>
{:else}
	<span class="rl" data-tip={tip}>
		<Swatch color={c.col} {bg} {size} />
		<span class:bold>{c.rt}</span>
		<span class="be" class:mono>{ver ? c.ver + ' · ' : ''}{c.be}</span>
	</span>
{/if}

<style>
	.rl {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		white-space: nowrap;
		min-width: 0;
	}
	.be {
		color: var(--fg3);
		font-size: 11px;
	}
	.mono {
		font-family: var(--mono);
	}
	.bold {
		font-weight: 500;
	}
</style>
