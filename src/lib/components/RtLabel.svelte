<script lang="ts">
	import { tipCard, tipWho } from '$lib/tip';
 import { configVersion } from '$lib/data/runtimes';
	import type { Cfg } from '$lib/data/types';
	import { ui } from '$lib/state.svelte';
	import VersionLink from './VersionLink.svelte';
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
	const defaultTip = $derived(tipCard({ who: tipWho(c, configVersion(ui.machine,c.id)), note: c.kind, action: 'open runtime profile' }));
</script>

<span class="label">
{#if profile}
	<button class="rl" onclick={() => ui.openProfile(c.rt)} data-tip={tip} data-tip-card={tip ? undefined : defaultTip}>
		<Swatch color={c.col} {bg} {size} />
		<span class:bold>{c.rt}</span>
		<span class="be" class:mono>{c.be}</span>
	</button>
{:else}
	<span class="rl" data-tip={tip}>
		<Swatch color={c.col} {bg} {size} />
		<span class:bold>{c.rt}</span>
		<span class="be" class:mono>{c.be}</span>
	</span>
{/if}
{#if ver}<VersionLink id={c.id} />{/if}
</span>

<style>
 .label{display:inline-flex;align-items:center;gap:8px}
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
