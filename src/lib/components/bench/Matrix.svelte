<script lang="ts">
	import { CFG } from '$lib/data/runtimes';
	import { OV } from '$lib/data/snapshot';
	import type { MetricKey, OvKey } from '$lib/data/types';
	import { n0 } from '$lib/format';
	import { heatCount, heatRatio } from '$lib/heat';
	import { cov, disp, isOff, isVisible, ratio } from '$lib/model';
	import { ui } from '$lib/state.svelte';
	import Carousel from '../Carousel.svelte';
	import RtLabel from '../RtLabel.svelte';
	import Tabs from '../Tabs.svelte';

	let { onmetric }: { onmetric: (m: MetricKey) => void } = $props();

	const KEYS = Object.keys(OV) as OvKey[];
	const gi = $derived(KEYS.indexOf(ui.group));
	const step = (d: number) => (ui.group = KEYS[(gi + d + KEYS.length) % KEYS.length]);
	const g = $derived(OV[ui.group]);

	const SHARED_NOTE: Record<OvKey, string> = {
		lat: '172 workloads excluded — not correct on every runtime.',
		mem: 'Peak RSS increase per phase.',
		code: 'Interpreters: not applicable.',
		cov: 'All 1,284 workloads.'
	};

	/** Badness of a count within its column across runtimes available on this machine, 0…1. */
	const countBadness = (col: number, v: number) => {
		const vals = CFG.filter((k) => !isOff(ui.scope, k.id)).map((k) => cov(k.id)[col]);
		const lo = Math.min(...vals);
		const hi = Math.max(...vals);
		const t = hi > lo ? (v - lo) / (hi - lo) : 0;
		return col === 0 ? 1 - t : t;
	};

	const rows = $derived.by(() => {
		const s = ui.scope;
		return CFG.filter((c) => isVisible(s, c)).map((c) => {
			const off = isOff(s, c.id);
			const cv = cov(c.id);
			const cells = g.cols.map((_, i) => {
				if (ui.group === 'cov') {
					const v = cv[i];
					if (off) return { text: '—', bg: 'transparent', color: 'var(--fg3)' };
					return {
						text: n0(v),
						bg: i !== 0 && v === 0 ? 'transparent' : heatCount(countBadness(i, v)),
						color: v || i === 0 ? 'var(--fg)' : 'var(--fg3)'
					};
				}
				const grp = ui.group as 'lat' | 'mem' | 'code';
				const r = ratio(s, grp, c.id, i);
				if (!r) return { text: off ? 'unavailable' : 'n/a', bg: 'transparent', color: 'var(--fg3)' };
				return { text: disp(s, grp, c.id, i)!.t, bg: heatRatio(r.r), color: 'var(--fg)' };
			});
			return {
				c,
				cells,
				covShort: off ? '—' : n0(cv[0]) + ' / 1,284',
				covBg: off ? 'transparent' : heatCount(countBadness(0, cv[0]))
			};
		});
	});

	const snapTaken = $derived(ui.snap === 's1' ? 'Snapshot · Sep 28, 2026 03:41 UTC' : 'Snapshot · Sep 21, 2026 03:38 UTC');
	const snapAgo = $derived(ui.snap === 's1' ? '2 days ago' : '9 days ago · newer snapshot available');
</script>

<div class="stack">
	<Tabs options={KEYS.map((k) => [k, OV[k].label])} value={ui.group} onselect={(k) => (ui.group = k)} />
	<Carousel title={g.label} sub="{gi + 1} / {KEYS.length} · {SHARED_NOTE[ui.group]}" onprev={() => step(-1)} onnext={() => step(1)}>
		<div class="snap">
			<span
				class="mono taken"
				data-tip={'Complete snapshot — every configuration ran the same harness (v3.2.0), corpus and machine in one batch.\nPick another snapshot in the scope bar.'}
				>{snapTaken}</span
			>
			<span class="small fg3">{snapAgo}</span>
		</div>
	</Carousel>
	<div class="tbl-wrap">
		<table class="mx" style:min-width="720px">
			<thead>
				<tr>
					<th class="stick th-label">Runtime</th>
					{#each g.cols as label, i (label)}
						<th class="colh">
							<button onclick={() => onmetric(g.metrics[i])} data-tip="Open the per-benchmark {label} matrix">{label}</button>
						</th>
					{/each}
					<th class="colh">Correct</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as r (r.c.id)}
					<tr>
						<td class="stick rtcell"><RtLabel c={r.c} profile mono bold /></td>
						{#each r.cells as x, i (i)}
							<td class="p0">
								<button
									class="cellbtn mono val"
									style:background={x.bg}
									style:color={x.color}
									onclick={() => onmetric(g.metrics[i])}
									data-tip={`${r.c.rt} ${r.c.be} — ${g.cols[i]}\n${x.text}\nClick to see per-workload results`}>{x.text}</button
								>
							</td>
						{/each}
						<td class="mono r corr" style:background={r.covBg}>{r.covShort}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<style>
	.snap {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		margin-left: 6px;
		padding-left: 14px;
		border-left: 1px solid var(--line);
	}
	.taken {
		font-size: 12px;
		cursor: help;
	}
	.colh {
		text-align: right;
		padding: 8px 12px;
		font-size: 12px;
	}
	.colh button {
		font-weight: 500;
	}
	.rtcell {
		padding: 7px 12px;
		white-space: nowrap;
	}
	.p0 {
		padding: 0;
	}
	.val {
		padding: 7px 12px;
	}
	.corr {
		padding: 7px 12px;
		font-size: 12px;
	}
</style>
