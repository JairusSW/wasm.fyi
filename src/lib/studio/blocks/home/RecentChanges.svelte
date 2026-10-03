<script lang="ts">
	import { EVENTS, SNAPS } from '$lib/data/snapshot';
	import { siteHref } from '$lib/links';
	import type { BlockProps } from '../../types';
	import Heading from './Heading.svelte';

	type C = { eyebrow: string; title: string; limit: number };
	let { config }: BlockProps<C> = $props();

	const events = $derived(
		[...EVENTS]
			.reverse()
			.slice(0, config.limit > 0 ? config.limit : undefined)
			.map((e) => ({ date: SNAPS[e.i].date, label: e.label }))
	);
</script>

<section class="col">
	<Heading eyebrow={config.eyebrow} title={config.title} />
	<div>
		{#each events as e, i (i)}
			<div class="event"><span class="mono s12 fg3">{e.date}</span><span>{e.label}</span></div>
		{/each}
	</div>
	<a class="link" href={siteHref(`/history`)}>All history and change reports</a>
</section>

<style>
	.col {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 40px 0 12px;
	}
	.col > .link {
		align-self: flex-start;
	}
	.s12 {
		font-size: 12px;
	}
	.event {
		display: grid;
		grid-template-columns: 100px 1fr;
		gap: 10px;
		border-bottom: 1px solid var(--line);
		padding: 8px 0;
	}
</style>
