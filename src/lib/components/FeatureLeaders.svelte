<script lang="ts">
	/** Headline cards for the Features page: support breadth, corpus pass rate and feature performance. */
	import type { CfgId } from '$lib/data/types';
	import { featureSpeed, featureSupport } from '$lib/feature-leaders';
	import { fmtAverage } from '$lib/format';
	import { ui } from '$lib/state.svelte';
	import { apiView } from '$lib/api/controller.svelte';
	import { tipCard } from '$lib/tip';
	import LeaderCards, { type LeaderCard, type LeaderPlace } from './LeaderCards.svelte';

	let { cols }: { cols: CfgId[] } = $props();

	const showSupport = () => (ui.compatView = 'support');

	/** Places from scores; equal scores share a place. `higher` decides the direction. */
	function rank<T>(items: T[], score: (x: T) => number, higher: boolean) {
		const sorted = [...items].sort((a, b) => (higher ? score(b) - score(a) : score(a) - score(b)));
		return sorted.map((x, i) => ({ x, place: sorted.findIndex((y) => score(y) === score(x)) + 1, index: i }));
	}
	const ordinal = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

	const cards = $derived.by((): LeaderCard[] => {
		const s = ui.scope;
		const { families, engines } = featureSupport(s);
		const supportCard = (label: string, score: (e: (typeof engines)[number]) => number, value: (e: (typeof engines)[number]) => string, points: string[]): LeaderCard => ({
			label,
			points,
			onselect: showSupport,
			places: rank(engines, score, true).map(({ x, place }): LeaderPlace => ({
				place,
				who: x.c,
				value: value(x),
				tip: tipCard({ kicker: `${label} · ${ordinal(place)}`, title: `${x.c.rt} ${x.c.be}`, value: value(x), sub: `${x.passed} / ${x.total} corpus tests · release ${x.release || 'not collected'}` })
			})),
			empty: { title: 'Not collected', sub: 'No measured engine has feature corpus results on this machine.' }
		});

		// Selected contract and feature averages, displayed as absolute time.
		// Performance in time units. Absolute times only compare over the same features, so each card
		// ranks runtimes on the features measured by every ranked runtime.
		const perfCard = (label: string, metric: 'steady' | 'compile', perfMetric: 'exec' | 'compile'): LeaderCard => {
			const { ranked, shared, families: measured, minFamilies } = featureSpeed(s, cols, metric);
			const fmt = (v: number) => fmtAverage(v,'ms');
			return {
				label,
				points: [
					`Per feature: ${metric==='compile'?'compilation time':'steady execution time per iteration'}, ${s.average==='mean'?'arithmetic mean':'geometric mean'} over its selected contracts`,
					`${s.average==='mean' ? 'Arithmetic mean' : 'Geometric mean'} over the ${shared} features measured by every ranked runtime`,
					`Contract selection: ${s.cohortMode==='per-engine'?'passed per engine':'passed on all shown engines'}; runtimes measured on fewer than ${minFamilies} of ${measured} measured features are not ranked`
				],
				onselect: () => {
					ui.compatView = 'perf';
					ui.perfMetric = perfMetric;
				},
				places: rank(ranked, (x) => x.v, false).map(({ x, place }): LeaderPlace => ({
					place,
					who: x.c,
					value: fmt(x.v),
					tip: tipCard({ kicker: `${label} · ${ordinal(place)}`, title: `${x.c.rt} ${x.c.be}`, value: fmt(x.v), sub: `average per-feature time · ${shared} shared features` })
				})),
				empty: { title: 'Not measured', sub: 'No runtimes share enough measured features to rank.' }
			};
		};

		return ([
			supportCard('Broadest support', (e) => e.full, (e) => `${e.full} / ${families}`, [
				'Feature families where every corpus test passed on the latest measured version',
				'Independent oracles; a family with any failed, skipped or missing test does not count',
				'Representative corpus tests, not full specification conformance'
			]),
			supportCard('Corpus pass rate', (e) => e.rate, (e) => `${(e.rate * 100).toFixed(1)}%`, [
				'Passed ÷ total corpus tests across every feature family, latest measured version',
				'Counts partial families too, unlike Broadest support'
			]),
			perfCard('Fastest feature compilation', 'compile', 'compile'),
			perfCard('Fastest feature execution', 'steady', 'exec')
		] as LeaderCard[]).map((c) => ({ ...c, loading: !apiView.ready }));
	});
</script>

<LeaderCards {cards} id="feature-leader-results" />
