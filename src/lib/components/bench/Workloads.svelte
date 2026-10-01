<script lang="ts">
	import { goto } from '$app/navigation';
	import { CFG } from '$lib/data/runtimes';
	import { BENCH, MET, PHASE_NOTE } from '$lib/data/snapshot';
	import { ST } from '$lib/data/status';
	import type { Bench, Cfg, MetricKey } from '$lib/data/types';
	import { fmtU, fx, n0 } from '$lib/format';
	import { heatRatio } from '$lib/heat';
	import { benchHref } from '$lib/links';
	import { benchVal, isVisible } from '$lib/model';
	import { ui } from '$lib/state.svelte';
	import Seg from '../Seg.svelte';
	import Swatch from '../Swatch.svelte';

	const cols = $derived(CFG.filter((c) => isVisible(ui.scope, c)));

	const cellFor = (b: Bench, c: Cfg, cf: number, caseLabel?: string) => {
		const s = ui.scope;
		const m = ui.metric;
		const u = MET[m].u;
		const r = benchVal(s, b, c.id, m, cf);
		const open = () => (ui.drawer = { type: 'cell', b: b.id, c: c.id, m, cf, caseLabel });
		if (r.st !== 'ok') {
			const t = ST[r.st];
			return { text: t[0] + ' ' + t[1], sub: '', bg: 'transparent', color: t[2], open };
		}
		const br = benchVal(s, b, s.baseline, m, cf);
		const ratio = br.st === 'ok' ? r.v / br.v : null;
		return {
			text: fmtU(r.v, u),
			sub: ratio && c.id !== s.baseline ? fx(ratio) : '',
			bg: heatRatio(ratio),
			color: 'var(--fg)',
			open
		};
	};

	type Row =
		| { kind: 'group'; name: string; count: string; open: boolean; cells: string[] }
		| {
				kind: 'item';
				b: Bench;
				name: string;
				indent: string;
				cases: number;
				expanded: boolean;
				tags: string[];
				cells: ReturnType<typeof cellFor>[];
		  };

	const view = $derived.by(() => {
		const s = ui.scope;
		const m = ui.metric;
		const q = ui.q.trim().toLowerCase();
		const match = (b: Bench) =>
			(!q || b.id.toLowerCase().includes(q) || b.tags.some((t) => t.includes(q))) && (!ui.tag || b.tags.includes(ui.tag));
		const rows: Row[] = [];
		let shown = 0;
		for (const g of BENCH) {
			const items: Bench[] = g.items.filter((b) => match({ ...b, group: g.g })).map((b) => ({ ...b, group: g.g }));
			if (!items.length) continue;
			shown += items.length;
			const collapsed = !!ui.collapsed[g.g];
			const gcells = cols.map((c) => {
				const rs = items
					.map((b) => {
						const a = benchVal(s, b, c.id, m);
						const bb = benchVal(s, b, s.baseline, m);
						return a.st === 'ok' && bb.st === 'ok' ? Math.log(a.v / bb.v) : null;
					})
					.filter((x): x is number => x != null);
				return rs.length ? fx(Math.exp(rs.reduce((x, y) => x + y, 0) / rs.length)) + ` n=${rs.length}` : '—';
			});
			rows.push({ kind: 'group', name: g.g, count: `${items.length} shown · ${n0(g.total)} in corpus`, open: !collapsed, cells: gcells });
			if (collapsed) continue;
			let list = items;
			if (ui.sortBy) {
				const { id, dir } = ui.sortBy;
				const sv = (b: Bench) => {
					const r = benchVal(s, b, id, m);
					return r.st === 'ok' ? r.v : Infinity;
				};
				list = [...items].sort((x, y) => (sv(x) - sv(y)) * dir || 0);
			}
			for (const b of list) {
				const expanded = !!ui.expanded[b.id];
				rows.push({
					kind: 'item',
					b,
					name: b.id,
					indent: '12px',
					cases: b.cases?.length ?? 0,
					expanded,
					tags: b.tags,
					cells: cols.map((c) => cellFor(b, c, 1))
				});
				if (expanded && b.cases)
					for (const [lab, f] of b.cases)
						rows.push({
							kind: 'item',
							b,
							name: '↳ ' + lab,
							indent: '32px',
							cases: 0,
							expanded: false,
							tags: [],
							cells: cols.map((c) => cellFor(b, c, f, lab))
						});
			}
		}
		return { rows, shown };
	});

	const sortClick = (c: Cfg) => {
		const sb = ui.sortBy;
		ui.sortBy = sb && sb.id === c.id ? (sb.dir > 0 ? { id: c.id, dir: -1 } : null) : { id: c.id, dir: 1 };
	};
	const tagClick = (t: string) => {
		if (t === 'simd') goto('/simd');
		else ui.tag = ui.tag === t ? null : t;
	};
	const legend = Object.values(ST);
</script>

<div class="head" id="workloads">
	<h2>All workloads</h2>
	<span class="s12 fg3">{MET[ui.metric].l} · {view.shown} workloads · click a cell for details</span>
</div>
<div class="row">
	<Seg
		options={Object.entries(MET).map(([k, v]) => [k as MetricKey, v.short])}
		value={ui.metric}
		onselect={(m) => (ui.metric = m)}
		size="md"
		label="Metric"
	/>
	{#if ui.tag}
		<button class="chip" onclick={() => (ui.tag = null)} data-tip="Clear tag filter">#{ui.tag} ✕</button>
	{/if}
	{#if ui.q}
		<button class="chip" onclick={() => (ui.q = '')} data-tip="Clear search">“{ui.q}” ✕</button>
	{/if}
</div>
<div class="phase-note">{PHASE_NOTE[ui.metric]}</div>
<div class="tbl-wrap scroll">
	<table class="mx" style:min-width="980px">
		<thead>
			<tr>
				<th class="stick th-label wl">Workload</th>
				{#each cols as c (c.id)}
					{@const mark = ui.sortBy?.id === c.id ? (ui.sortBy.dir > 0 ? '↑' : '↓') : ''}
					<th class="colh">
						<button class="sort" onclick={() => sortClick(c)} aria-label="Sort by {c.rt} {c.be}">
							<span class="rtn"><Swatch color={c.col} bg={c.hollow ? 'transparent' : c.col} />{c.rt}<span class="small fg3">{mark}</span></span>
							<span class="mono micro fg3">{c.be}{c.id === ui.baseline ? ' · BASE' : ''}</span>
						</button>
					</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each view.rows as r, ri (ri)}
				{#if r.kind === 'group'}
					<tr class="sec">
						<td class="stick grp">
							<button
								class="grp-btn"
								aria-expanded={r.open}
								onclick={() => (ui.collapsed = { ...ui.collapsed, [r.name]: r.open })}
							>
								<span class="mono caret">{r.open ? '▾' : '▸'}</span><span class="w6">{r.name}</span><span class="small fg3">{r.count}</span>
							</button>
						</td>
						{#each r.cells as text, k (k)}
							<td class="mono small fg2 r gcell" data-tip={`${r.name} — ${cols[k].rt} ${cols[k].be}\n${text}\nCorpus aggregate (geomean)`}>{text}</td>
						{/each}
					</tr>
				{:else}
					<tr>
						<td class="stick item" style:padding-left={r.indent}>
							<div class="item-line">
								{#if r.cases}
									<button
										class="cases mono"
										aria-label="Show parameterized cases"
										onclick={() => (ui.expanded = { ...ui.expanded, [r.b.id]: !r.expanded })}>{r.expanded ? '− ' : '+ '}{r.cases}</button
									>
								{/if}
								<a class="mono name" href={benchHref(r.b.id)}>{r.name}</a>
								{#each r.tags as t (t)}
									<button class="tag" onclick={() => tagClick(t)} data-tip={t === 'simd' ? 'Open the SIMD page' : `Filter benchmarks to #${t}`}>#{t}</button>
								{/each}
							</div>
						</td>
						{#each r.cells as x, k (k)}
							<td class="p0">
								<button
									class="cellbtn wcell"
									style:background={x.bg}
									style:color={x.color}
									onclick={x.open}
									data-tip={`${r.name} — ${cols[k].rt} ${cols[k].be}\n${[x.text, x.sub].filter(Boolean).join(' · ')}\nClick for distribution & run record`}
								>
									<span class="mono s12 nowrap">{x.text}</span>
									<span class="mono micro fg3 nowrap">{x.sub}</span>
								</button>
							</td>
						{/each}
					</tr>
				{/if}
			{/each}
		</tbody>
	</table>
</div>
<div class="legend small">
	{#each legend as [g, l, c] (l)}<span style:color={c}>{g} {l}</span>{/each}
</div>

<style>
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 6px 16px;
		scroll-margin-top: 12px;
	}
	h2 {
		font-size: 14px;
		font-weight: 600;
		border-top: 1px solid var(--line);
		padding-top: 16px;
	}
	.s12 {
		font-size: 12px;
	}
	.w6 {
		font-weight: 600;
	}
	.chip {
		border: 1px solid var(--line2);
		background: var(--bg3);
		padding: 2px 8px;
		font-size: 12px;
	}
	.phase-note {
		font-size: 12px;
		color: var(--fg2);
		border-left: 2px solid var(--line2);
		padding-left: 10px;
	}
	.scroll {
		max-height: 68vh;
	}
	.wl {
		min-width: 250px;
	}
	.colh {
		padding: 6px 10px;
		text-align: right;
	}
	.sort {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 1px;
		margin-left: auto;
	}
	.rtn {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
	}
	td.stick.grp {
		background: var(--bg3);
		padding: 6px 12px;
	}
	.grp-btn {
		display: flex;
		gap: 8px;
		align-items: baseline;
	}
	.caret {
		width: 10px;
	}
	.gcell {
		padding: 6px 10px;
	}
	.item {
		padding: 5px 12px;
	}
	.item-line {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}
	.cases {
		border: 1px solid var(--line2);
		padding: 0 4px;
		font-size: 10px;
		color: var(--fg2);
	}
	.name {
		font-size: 12px;
		text-decoration: none;
	}
	.name:hover {
		text-decoration: underline;
	}
	.tag {
		font-size: 10px;
		color: var(--fg3);
	}
	.tag:hover {
		color: var(--fg);
	}
	.p0 {
		padding: 0;
	}
	.wcell {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		justify-content: center;
		padding: 5px 10px;
		min-height: 34px;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
	}
</style>
