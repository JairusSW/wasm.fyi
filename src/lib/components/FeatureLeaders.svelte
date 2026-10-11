<script lang="ts">
	/** Headline cards for the Features page: support breadth, corpus pass rate and feature performance. */
	import { COMPAT, FEATURE_ROWS } from '$lib/data/features';
	import { CB, FEATURE_CFG } from '$lib/data/runtimes';
	import type { CfgId } from '$lib/data/types';
	import { familyCohort,featureAverage } from '$lib/feature-values';
	import { fmtAverage } from '$lib/format';
	import {compilationCandidate} from '$lib/ranking-policy';
	import { compileExcluded, featureContracts } from '$lib/model';
	import { ui } from '$lib/state.svelte';
	import { apiView } from '$lib/api/controller.svelte';
	import { engineFeatureVersions, runtimeFeatureTrack } from '$lib/support';
	import { tipCard } from '$lib/tip';
	import { shortVersion } from '$lib/version-identity';
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
		const fams = FEATURE_ROWS.filter((f) => featureContracts(f.id).length > 0);
		// One entrant per configuration (backend), named like everywhere else on the site.
		const engines = FEATURE_CFG.filter((c) => !s.hide[c.id] && ['stable','development'].some(channel=>engineFeatureVersions(c.rt,s,channel as 'stable'|'development',c.id).length>0)).map((c) => {
			const channel=engineFeatureVersions(c.rt,s,'stable',c.id).length?'stable':'development';
			const tracks = fams.map((f) => ({ f, t: runtimeFeatureTrack(c.rt, f, s, channel, undefined, c.id) }));
			const full = tracks.filter(({ t }) => t.expected > 0 && t.pass === t.expected);
			const passed = tracks.reduce((sum, { t }) => sum + t.pass, 0);
			const total = tracks.reduce((sum, { t }) => sum + t.expected, 0);
			return {
				rt: c.rt,
				who: { id: c.id, col: c.col, hollow: c.hollow, rt: c.rt, be: c.be },
				release: shortVersion(engineFeatureVersions(c.rt, s, channel, c.id)[0] ?? '').replace(/\/source-.*/, ''),
				full: full.length,
				rate: total ? passed / total : 0,
				passed,
				total
			};
		});
		const supportCard = (label: string, score: (e: (typeof engines)[number]) => number, value: (e: (typeof engines)[number]) => string, points: string[]): LeaderCard => ({
			label,
			points,
			onselect: showSupport,
			places: rank(engines.filter((e) => e.total > 0), score, true).map(({ x, place }): LeaderPlace => ({
				place,
				who: x.who,
				value: value(x),
				tip: tipCard({ kicker: `${label} · ${ordinal(place)}`, title: `${x.who.rt} ${x.who.be}`, value: value(x), sub: `${x.passed} / ${x.total} corpus tests · release ${x.release || 'not collected'}` })
			})),
			empty: { title: 'Not collected', sub: 'No measured engine has feature corpus results on this machine.' }
		});

		// Selected contract and feature averages, displayed as absolute time.
		// Performance in time units. Absolute times only compare over the same features, so each card
		// ranks runtimes on the features measured by every ranked runtime.
		const perfCard = (label: string, metric: 'steady' | 'compile', perfMetric: 'exec' | 'compile'): LeaderCard => {
			const ids = cols.filter((id) => CB[id] && !compileExcluded(s, CB[id], metric) && compilationCandidate(CB[id].rt,metric));
			const fams = COMPAT.flatMap((sec) => sec.fams)
				.map((f) => {
					const comparison=familyCohort(s,f.id,cols,metric);
					const values=ids.map(id=>comparison.values[cols.indexOf(id)]);
					return {values};
				})
				.filter((x) => x.values.some((v) => v != null));
			const minFamilies = Math.max(3, Math.ceil(fams.length / 2));
			let cand = ids.map((id, k) => ({ id, k, n: fams.filter((x) => x.values[k] != null).length })).filter((x) => x.n >= minFamilies);
			let shared = fams.filter((x) => cand.every((c) => x.values[c.k] != null));
			// Too few features in common: drop the runtime with the narrowest coverage and retry.
			while (shared.length < 3 && cand.length > 2) {
				cand = [...cand].sort((a, b) => b.n - a.n).slice(0, -1);
				shared = fams.filter((x) => cand.every((c) => x.values[c.k] != null));
			}
			const score = (k: number) => featureAverage(shared.map(x=>x.values[k]!),s.average)!;
			const ranked = shared.length ? cand.map((c) => ({ c: CB[c.id], v: score(c.k) })) : [];
			const fmt = (v: number) => fmtAverage(v,'ms');
			return {
				label,
				points: [
					`Per feature: ${metric==='compile'?'compilation time':'steady execution time per iteration'}, ${s.average==='mean'?'arithmetic mean':'geometric mean'} over its selected contracts`,
					`${s.average==='mean' ? 'Arithmetic mean' : 'Geometric mean'} over the ${shared.length} features measured by every ranked runtime`,
					`Contract selection: ${s.cohortMode==='per-engine'?'passed per engine':'passed on all shown engines'}; runtimes measured on fewer than ${minFamilies} of ${fams.length} measured features are not ranked`
				],
				onselect: () => {
					ui.compatView = 'perf';
					ui.perfMetric = perfMetric;
				},
				places: rank(ranked, (x) => x.v, false).map(({ x, place }): LeaderPlace => ({
					place,
					who: x.c,
					value: fmt(x.v),
					tip: tipCard({ kicker: `${label} · ${ordinal(place)}`, title: `${x.c.rt} ${x.c.be}`, value: fmt(x.v), sub: `average per-feature time · ${shared.length} shared features` })
				})),
				empty: { title: 'Not measured', sub: 'No runtimes share enough measured features to rank.' }
			};
		};

		return ([
			supportCard('Broadest support', (e) => e.full, (e) => `${e.full} / ${fams.length}`, [
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
