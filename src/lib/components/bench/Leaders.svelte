<script lang="ts">
	import {apiView,aggregateKey} from '$lib/api/controller.svelte';
	import {datasetView} from '$lib/api/view.svelte';
	import type { MetricKey, OvKey } from '$lib/data/types';
	import { leader } from '$lib/model';
	import { CFG } from '$lib/data/runtimes';
	
	import { ui } from '$lib/state.svelte';
	import Swatch from '../Swatch.svelte';
	import { relative } from '$lib/format';
	import { tipCard, tipWho } from '$lib/tip';

	let { onmetric, onoverview }: { onmetric: (m: MetricKey) => void; onoverview: (group: OvKey) => void } = $props();
	let expanded = $state(false);


	const rankingNote = 'Places rank measured means; overlapping uncertainty is not a clear lead';
	const leaders = $derived([
		{ ...leader(ui.scope, 'Fastest compilation', 'lat', 0, 'compile'), overview: null, points: [rankingNote, 'Transpiler pipelines are excluded from fastest compilation; their full translate + compile times remain in the table.'] },
		{ ...leader(ui.scope, 'Fastest instantiation', 'lat', 1, 'inst'), overview: null, points: [rankingNote] },
		{ ...leader(ui.scope, 'Lowest average peak RSS', 'mem', 3, 'rss'), overview: 'mem' as OvKey,
			points: [
                'Arithmetic mean of available compile, instantiate, first-call and steady run peak RSS measurements',
                'Kernel-reported process lifetime peaks; this is not time-averaged RSS',
                'Equal weight per measured workload-phase; missing measurements are omitted',
                'Transpiler compile peaks use max(transpiler, compiler); phase peaks are averaged, not added'
			] },
		{ ...leader(ui.scope, 'Fastest execution', 'lat', 3, 'steady'), overview: null, points: [rankingNote] }
	]);
	const ordinal = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);
	const placeTip = (l: (typeof leaders)[number], p: (typeof leaders)[number]['places'][number]) =>
		tipCard({ kicker: `${l.label} · ${ordinal(p.place)}`, who: tipWho(p.cfg), value: p.value, sub: p.place > 1 ? `${relative(p.ratio / l.places[0].ratio, ui.deltaFormat)} vs 1st` : 'leader' });
</script>

<div class="leader-panel">
<div class="tiles leaders" id="benchmark-leader-results">
	{#each leaders as l (l.label)}
		<button
			class="leader hoverbg"
			onclick={() => l.overview ? onoverview(l.overview) : onmetric(l.metric)}
			data-tip-card={tipCard({ title: l.label, chips: l.places.length > 1 ? [l.clear ? 'clear lead' : 'intervals overlap'] : [], points: l.points, action: 'see the underlying results' })}
		>
			{#if l.places.length}
				{@const first = l.places[0]}
				<span class="results">
					<!-- Label sits in the leader column so the runner-up list can start at the top. -->
					<span class="lead">
						<span class="kicker">{l.label}</span>
						<span class="first" data-tip-card={placeTip(l, first)}>
							<span class="mono value">{first.value}</span>
							<span class="who">
								<Swatch color={first.cfg.col} bg={first.cfg.hollow ? 'transparent' : first.cfg.col} size={9} />
								<span class="w5">{first.cfg.rt}</span>
								<span class="mono small fg3 backend">{first.cfg.be}</span>
							</span>
						</span>
					</span>
					<span class="places" aria-label="Next places by measured mean">
						{#each l.places.slice(1, expanded ? undefined : 5) as p (p.cfg.id)}
							<span class="place" data-tip-card={placeTip(l, p)}>
								<span class="mono small fg3">{p.place === 2 ? '2nd' : p.place === 3 ? '3rd' : `${p.place}th`}</span>
								<span class="entrant"><span class="who small"><Swatch color={p.cfg.col} bg={p.cfg.hollow ? 'transparent' : p.cfg.col} size={6} /><span>{p.cfg.rt}</span></span><span class="mono micro fg3 backend">{p.cfg.be}</span></span>
								<span class="mono small result-value">{p.value}</span>
							</span>
						{/each}
					</span>
				</span>
			{:else}
				<span class="kicker">{l.label}</span>
				{@const key=aggregateKey(ui.scope,l.overview==='mem'?'rssAverage':l.metric)}
				{@const error=apiView.aggregateErrors[key]}
				{@const loading=!!datasetView.revision&&!apiView.aggregates[key]&&!error}
				<span class="unclear">{loading?'Loading…':error?'Unavailable':'No clear leader'}</span>
				<span class="small fg3">{loading?'Fetching the selected comparison.':error||l.versus}</span>
			{/if}

		</button>
	{/each}
</div>
<button class="expand-bar hoverbg small" aria-expanded={expanded} aria-controls="benchmark-leader-results" onclick={() => expanded = !expanded}>
	{expanded ? 'Show top five' : 'Show all results'} <span aria-hidden="true">{expanded ? '▴' : '▾'}</span>
</button>
</div>

<style>

	.leader-panel {
		min-width: 0;
	}
	.expand-bar {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		width: 100%;
		padding: 5px 14px;
		border: 1px solid var(--line);
		border-top: 0;
		border-radius: 0 0 4px 4px;
		background: var(--bg2);
		color: var(--fg3);
	}
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
	.lead,
	.first,
	.places {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}
	.places {
		gap: 4px;
	}
	.place {
		display: grid;
		grid-template-columns: 24px minmax(0, 1fr) auto;
		gap: 5px;
		align-items: baseline;
	}
	/* Name and backend share one line so five places fit beside the leader. */
	.entrant {
		display: flex;
		align-items: baseline;
		gap: 5px;
		min-width: 0;
	}
	.entrant .who {
		flex: none;
		max-width: 100%;
	}
	.entrant .backend {
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
	/* Phones: a zoomed-out 2×2 grid — winner on top, runners-up as compact lines beneath. */
	@media (max-width: 720px) {
		.leaders {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.leader {
			padding: 10px;
			gap: 6px;
		}
		.leader .kicker {
			font-size: 10px;
			letter-spacing: 0.04em;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		.results {
			grid-template-columns: minmax(0, 1fr);
			gap: 8px;
		}
		.value {
			font-size: 18px;
		}
		.first {
			gap: 3px;
		}
		.first .backend {
			font-size: 10px;
		}
		.places {
			gap: 3px;
			padding-top: 6px;
			border-top: 1px solid var(--line);
		}
		.place {
			grid-template-columns: 22px minmax(0, 1fr) auto;
			gap: 4px;
			align-items: center;
		}
		.place > :global(*) {
			font-size: 11px;
		}
		.entrant .backend {
			display: none;
		}
		.expand-bar {
			padding: 9px 14px;
		}
	}
</style>
