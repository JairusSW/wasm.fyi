<script lang="ts">
	import { FEATS, PROPS } from '$lib/data/features';
	import { PROPOSAL_IDS, siteHref } from '$lib/links';
	import type { BlockProps } from '../../types';
	import Heading from './Heading.svelte';

	type C = { eyebrow: string; title: string; lede: string };
	let { config }: BlockProps<C> = $props();

	const cards = PROPOSAL_IDS.map((id) => ({ id, title: PROPS[id].title, q: PROPS[id].q, phase: FEATS.find((f) => f.id === id)!.phase }));
</script>

<section class="block">
	<Heading eyebrow={config.eyebrow} title={config.title} lede={config.lede} />
	<div class="props">
		{#each cards as p (p.id)}
			<a class="prop panel" href={siteHref(`/${p.id}`)} data-tip="Open the {p.title} page: status, adoption & performance">
				<span class="prop-head"><span class="s18 w6">{p.title}</span><span class="mono micro fg3">{p.phase}</span></span>
				<span class="fg2">{p.q}</span>
			</a>
		{/each}
	</div>
</section>

<style>
	.block {
		display: flex;
		flex-direction: column;
		gap: 20px;
		padding: 40px 0 12px;
	}
	.s18 {
		font-size: 18px;
	}
	.w6 {
		font-weight: 600;
	}
	.props {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 14px;
	}
	.prop {
		padding: 18px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		text-decoration: none;
		line-height: 1.45;
	}
	.prop:hover {
		border-color: var(--fg3);
	}
	.prop-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 8px;
	}
</style>
