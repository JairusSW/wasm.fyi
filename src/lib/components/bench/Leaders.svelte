<script lang="ts">
	import type { MetricKey } from '$lib/data/types';
	import { leader } from '$lib/model';
	import { ui } from '$lib/state.svelte';
	import Swatch from '../Swatch.svelte';

	let { onmetric }: { onmetric: (m: MetricKey) => void } = $props();

	const leaders = $derived([
		leader(ui.scope, 'Fastest compilation', 'lat', 0, 'compile'),
		leader(ui.scope, 'Fastest instantiation', 'lat', 1, 'inst'),
		leader(ui.scope, 'Fastest execution', 'lat', 3, 'steady'),
		leader(ui.scope, 'Smallest generated code', 'code', 3, 'code')
	]);
</script>

<div class="tiles leaders">
	{#each leaders as l (l.label)}
		<button
			class="leader hoverbg"
			onclick={() => onmetric(l.metric)}
			data-tip={[l.label, 'Places rank measured means; overlapping uncertainty does not establish a clear lead.', 'Click to see the underlying results'].join('\n')}
		>
			<span class="kicker">{l.label}</span>
			{#if l.places.length}
				{@const first = l.places[0]}
				<span class="results">
					<span class="first" title={`${first.cfg.rt} ${first.cfg.be} · ${first.value}`}>
						<span class="mono value">{first.value}</span>
						<span class="who">
							<Swatch color={first.cfg.col} bg={first.cfg.hollow ? 'transparent' : first.cfg.col} size={9} />
							<span class="w5">{first.cfg.rt}</span>
							<span class="mono small fg3 backend">{first.cfg.be}</span>
						</span>
					</span>
					<span class="places" aria-label="Next places by measured mean">
						{#each l.places.slice(1) as p (p.cfg.id)}
							<span class="place" title={`${p.cfg.rt} ${p.cfg.be} · ${p.value}`}>
								<span class="mono small fg3">{p.place === 2 ? '2nd' : '3rd'}</span>
								<span class="entrant"><span class="who small"><Swatch color={p.cfg.col} bg={p.cfg.hollow ? 'transparent' : p.cfg.col} size={6} /><span>{p.cfg.rt}</span></span><span class="mono micro fg3 backend">{p.cfg.be}</span></span>
								<span class="mono small result-value">{p.value}</span>
							</span>
						{/each}
					</span>
				</span>
			{:else}
				<span class="unclear">No clear leader</span>
				<span class="small fg3">{l.versus}</span>
			{/if}
		</button>
	{/each}
</div>

<style>
	.leaders {
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
	}
	.leader {
		padding: 12px 14px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
		text-align: left;
	}
	.value {
		font-size: 22px;
		font-weight: 500;
		letter-spacing: -0.02em;
	}
	.who {
		display: flex;
		align-items: center;
		gap: 7px;
	}
	.results {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr);
		gap: 16px;
		align-items: start;
	}
	.first .who {
		min-width: 0;
		gap: 5px;
	}
	.first .w5 {
		flex: none;
	}
	.first .backend {
		min-width: 0;
		flex: 1;
	}
	.first,
	.places {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}
	.place {
		display: grid;
		grid-template-columns: 24px minmax(0, 1fr) auto;
		gap: 5px;
		align-items: start;
	}
	.entrant {
		min-width: 0;
	}
	.entrant .who {
		gap: 4px;
	}
	.entrant .who > span:last-child {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.backend {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.result-value {
		white-space: nowrap;
	}
	.w5 {
		font-weight: 500;
	}
	.unclear {
		font-size: 18px;
		font-weight: 500;
	}
</style>
