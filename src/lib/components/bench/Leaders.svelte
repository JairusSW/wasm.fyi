<script lang="ts">
	import {apiView,aggregateKey} from '$lib/api/controller.svelte';
	import {datasetView} from '$lib/api/view.svelte';
	import type { MetricKey, OvKey } from '$lib/data/types';
	import { leader } from '$lib/model';
	import { ui } from '$lib/state.svelte';
	import { relative } from '$lib/format';
	import { tipCard, tipWho } from '$lib/tip';
	import LeaderCards, { type LeaderCard } from '../LeaderCards.svelte';

	let { onmetric, onoverview }: { onmetric: (m: MetricKey) => void; onoverview: (group: OvKey) => void } = $props();

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
	const cards = $derived(leaders.map((l): LeaderCard => {
		const key = aggregateKey(ui.scope, l.overview === 'mem' ? 'rssAverage' : l.metric);
		const error = apiView.aggregateErrors[key];
		const loading = !error && (apiView.serverAggregates ? !apiView.precomputed[key] : !!datasetView.revision && !apiView.aggregates[key]);
		return {
			label: l.label,
			points: l.points,
			chips: l.places.length > 1 ? [l.clear ? 'clear lead' : 'intervals overlap'] : [],
			onselect: () => (l.overview ? onoverview(l.overview) : onmetric(l.metric)),
			places: l.places.map((p) => ({
				place: p.place,
				who: p.cfg,
				value: p.value,
				tip: tipCard({ kicker: `${l.label} · ${ordinal(p.place)}`, who: tipWho(p.cfg), value: p.value, sub: p.place > 1 ? `${relative(p.ratio / l.places[0].ratio, ui.deltaFormat)} vs 1st` : 'leader' })
			})),
			loading: loading || !apiView.ready,
			empty: { title: loading ? 'Loading…' : error ? 'Unavailable' : 'No clear leader', sub: loading ? 'Fetching the selected comparison.' : error || l.versus }
		};
	}));
</script>

<LeaderCards {cards} id="benchmark-leader-results" />
