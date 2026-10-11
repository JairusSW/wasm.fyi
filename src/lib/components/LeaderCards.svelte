<script lang="ts" module>
	export type LeaderEntrant = { id: string; col: string; hollow: boolean; rt: string; be: string };
	export type LeaderPlace = { place: number; who: LeaderEntrant; value: string; tip?: string };
	export type LeaderCard = {
		label: string;
		places: LeaderPlace[];
		points?: string[];
		chips?: string[];
		onselect: () => void;
		empty?: { title: string; sub: string };
		/** Still fetching: a skeleton stands in for the places. */
		loading?: boolean;
	};
</script>

<script lang="ts">
	/** Leader cards: a headline winner with the next places beside it. Shared by Benchmarks and Features. */
	import Swatch from './Swatch.svelte';
	import { tipCard } from '$lib/tip';

	let { cards, id }: { cards: LeaderCard[]; id: string } = $props();
	let expanded = $state(false);
	const ordinal = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);
</script>

<div class="leader-panel">
<div class="tiles leaders" {id}>
	{#each cards as l (l.label)}
		<button
			class="leader hoverbg"
			onclick={l.onselect}
			data-tip-card={tipCard({ title: l.label, chips: l.chips ?? [], points: l.points ?? [], action: 'see the underlying results' })}
		>
			{#if l.loading && !l.places.length}
				<span class="results" aria-busy="true">
					<span class="lead">
						<span class="kicker">{l.label}</span>
						<span class="first">
							<span class="skel" style:width="5.5em" style:height="1.1em"></span>
							<span class="skel" style:width="8em"></span>
						</span>
					</span>
					<span class="places" aria-hidden="true">
						{#each [72, 60, 66, 54] as w (w)}
							<span class="place"><span class="skel" style:width="1.6em"></span><span class="skel" style:width="{w}%"></span><span class="skel" style:width="3em"></span></span>
						{/each}
					</span>
				</span>
			{:else if l.places.length}
				{@const first = l.places[0]}
				<span class="results">
					<!-- Label sits in the leader column so the runner-up list can start at the top. -->
					<span class="lead">
						<span class="kicker">{l.label}</span>
						<span class="first" data-tip-card={first.tip}>
							<span class="mono value">{first.value}</span>
							<span class="who">
								<Swatch color={first.who.col} bg={first.who.hollow ? 'transparent' : first.who.col} size={9} />
								<span class="w5">{first.who.rt}</span>
								<span class="mono small fg3 backend">{first.who.be}</span>
							</span>
						</span>
					</span>
					<span class="places" aria-label="Next places">
						{#each l.places.slice(1, expanded ? undefined : 5) as p (p.who.id)}
							<span class="place" data-tip-card={p.tip}>
								<span class="mono small fg3">{ordinal(p.place)}</span>
								<span class="entrant"><span class="who small"><Swatch color={p.who.col} bg={p.who.hollow ? 'transparent' : p.who.col} size={6} /><span>{p.who.rt}</span></span><span class="mono micro fg3 backend">{p.who.be}</span></span>
								<span class="mono small result-value">{p.value}</span>
							</span>
						{/each}
					</span>
				</span>
			{:else}
				<span class="kicker">{l.label}</span>
				<span class="unclear">{l.empty?.title ?? 'No clear leader'}</span>
				<span class="small fg3">{l.empty?.sub ?? ''}</span>
			{/if}
		</button>
	{/each}
</div>
<button class="expand-bar hoverbg small" aria-expanded={expanded} aria-controls={id} onclick={() => (expanded = !expanded)}>
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
