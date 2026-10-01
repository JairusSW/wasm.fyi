<script lang="ts">
	import RtLabel from '$lib/components/RtLabel.svelte';
	import Seg from '$lib/components/Seg.svelte';
	import Swatch from '$lib/components/Swatch.svelte';
	import { BROWSERS, COMPAT, FEATS, PROPS } from '$lib/data/features';
	import { CFG, RTB, SA } from '$lib/data/runtimes';
	import { OV } from '$lib/data/snapshot';
	import type { RatioCi } from '$lib/data/types';
	import { H, fmtU, fx, n0 } from '$lib/format';
	import { heatRatio } from '$lib/heat';
	import { PROPOSAL_IDS } from '$lib/links';
	import { cellView, compatCell, isOff, isVisible, kidCells, mf } from '$lib/model';
	import { ui } from '$lib/state.svelte';
	import { browserCell, supportCell } from '$lib/support';
	import type { SupportCode } from '$lib/data/types';

	const propLinks = PROPOSAL_IDS.map((id) => ({ id, label: PROPS[id].title }));

	// ── Support matrix ─────────────────────────────────────────────────────
	const featCols = [
		...BROWSERS.map((b) => ({ label: b, sub: 'browser', rt: null as string | null })),
		...SA.map((id) => ({ label: RTB[id].name, sub: RTB[id].lang, rt: RTB[id].cfg ? id : null }))
	];
	const groups = [...new Set(FEATS.map((f) => f.g))].map((g) => ({
		g,
		rows: FEATS.filter((f) => f.g === g).map((f) => {
			const rc = [...f.r] as SupportCode[];
			const nYes = f.b.filter((v) => /^\d/.test(v)).length + rc.filter((c) => c === 'y').length;
			return { f, count: `${nYes} of ${BROWSERS.length + SA.length}`, cells: [...f.b.map(browserCell), ...rc.map(supportCell)] };
		})
	}));

	// ── Spec tests ─────────────────────────────────────────────────────────
	const cols = $derived(CFG.filter((c) => isVisible(ui.scope, c)));
	const offCell = { glyph: '—', text: 'config unavailable', sub: '', subColor: 'var(--fg3)', segs: [], color: 'var(--fg3)' };

	// ── Proposal performance ───────────────────────────────────────────────
	const PB: Record<string, [number, number]> = {
		simd: [18, 24],
		'relaxed-simd': [14, 8],
		threads: [420, 12],
		exceptions: [9.5, 10],
		'tail-call': [31, 6],
		memory64: [64, 9],
		gc: [880, 18],
		'multi-memory': [22, 4],
		'extended-const': [0.8, 3],
		'wasi-p1': [140, 14],
		'wasi-p2': [210, 11],
		'cm-abi': [12, 9],
		'cm-res': [6.4, 5],
		'cm-async': [48, 4]
	};
	const PERF_NOTE = {
		exec: 'Steady-state execution per call · geomean across each proposal corpus.',
		compile: 'Compilation time · geomean across each proposal corpus.',
		mem: 'Execution peak RSS increase · geomean across each proposal corpus.'
	};
	const perfSecs = $derived.by(() => {
		const s = ui.scope;
		const pm = ui.perfMetric;
		const [grp, col, unit] = ({ exec: ['lat', 3, 'ms'], compile: ['lat', 0, 'ms'], mem: ['mem', 2, 'MB'] } as const)[pm];
		return COMPAT.slice(1).map((sec) => ({
			sec: sec.sec,
			rows: sec.fams.map((f) => {
				const [base, n] = PB[f.id] || [10, 4];
				const vals = cols.map((c) => {
					const ci = CFG.indexOf(c);
					if (isOff(s, c.id)) return { st: 'unavailable' };
					const [av, fr] = f.r[ci].split(':');
					if (av === 'u') return { st: 'unavailable' };
					if (av === '?' || av === 'n') return { st: 'not measured' };
					if (fr && parseFloat(fr) < 0.9) return { st: 'fails correctness' };
					const o = OV[grp].vals[c.id] as RatioCi[];
					const noise = Math.exp((H(f.id + c.id + pm) - 0.5) * 0.7);
					const b = pm === 'exec' ? base * 1e-3 : pm === 'compile' ? 2 + n * 1.3 : 8 + base * 0.02;
					return { v: b * o[col][0] * noise * mf(s.machine, c.id), flag: av === 'f' };
				});
				const nums = vals.map((x) => x.v).filter((v): v is number => v != null);
				const min = Math.min(...nums);
				return {
					f,
					corpus: `proposals/${f.id} · ${n} workloads (pending)`,
					cells: vals.map((x) =>
						x.v != null
							? {
									text: (x.flag ? '⚑ ' : '') + fmtU(x.v, unit),
									sub: x.v === min ? 'lowest' : fx(x.v / min).replace('×', '× lowest'),
									bg: heatRatio(x.v / min),
									color: 'var(--fg)',
									fw: x.v === min ? 600 : 400
								}
							: { text: x.st!, sub: '', bg: 'transparent', color: x.st === 'fails correctness' ? 'var(--st-fail)' : 'var(--fg3)', fw: 400 }
					)
				};
			})
		}));
	});
</script>

<svelte:head>
	<title>Features · wasm.fyi</title>
</svelte:head>

<div class="head">
	<span class="mono small fg3 path">wasm.fyi/features</span>
	<h1>Features</h1>
	<span class="s12 fg3 lim">Feature status across browsers and runtimes, plus observed spec test results and per-proposal performance.</span>
</div>
<div class="row">
	<Seg
		options={[
			['support', 'Support'],
			['tests', 'Spec tests'],
			['perf', 'Performance']
		]}
		value={ui.compatView}
		onselect={(v) => (ui.compatView = v as typeof ui.compatView)}
		size="md"
		label="View"
	/>
	{#if ui.compatView === 'perf'}
		<Seg
			options={[
				['exec', 'Execution'],
				['compile', 'Compilation'],
				['mem', 'Peak memory']
			]}
			value={ui.perfMetric}
			onselect={(v) => (ui.perfMetric = v as typeof ui.perfMetric)}
			size="md"
			label="Metric"
		/>
	{/if}
</div>

{#snippet proposalLinks()}
	{#each propLinks as p (p.id)}
		<a class="plink" href="/{p.id}" data-tip="Open the {p.label} page: status, adoption & performance">{p.label}</a>
	{/each}
{/snippet}

{#if ui.compatView === 'support'}
	<div class="legend">
		<span class="lg"><span class="box" style:background="oklch(0.72 0.14 150 / 0.18)"></span>● supported (version shipped)</span>
		<span class="lg"><span class="box" style:background="oklch(0.77 0.14 60 / 0.16)"></span>⚑ flag · ◐ partial</span>
		<span>— no · ? unknown · · not applicable</span>
		<span class="fg3">Proposal pages:</span>
		{@render proposalLinks()}
	</div>
	<div class="tbl-wrap tall">
		<table class="mx" style:min-width="1100px">
			<thead>
				<tr>
					<th class="stick th-label" style:min-width="230px">Feature</th>
					{#each featCols as h (h.label)}
						<th class="fh">
							{#if h.rt}
								{@const rt = h.rt}
								<button class="w5" onclick={() => ui.openProfile(rt)} data-tip="Open {h.label} runtime profile">{h.label}</button>
							{:else}
								<span class="w5">{h.label}</span>
							{/if}
							<div class="micro fg3 w4">{h.sub}</div>
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each groups as g (g.g)}
					<tr class="sec">
						<td class="stick secname">{g.g}</td>
						{#each featCols as h (h.label)}<td></td>{/each}
					</tr>
					{#each g.rows as r (r.f.id)}
						<tr>
							<td class="stick fname">
								{#if r.f.page}<a class="link w5" href="/{r.f.page}">{r.f.name}</a>{:else}<span class="w5">{r.f.name}</span>{/if}
								<div class="mono micro fg3">{r.f.phase} · {r.count}</div>
							</td>
							{#each r.cells as x, k (k)}
								<td class="fcell" style:background={x.bg} data-tip={`${r.f.name} — ${featCols[k].label}\n${x.glyph} ${x.text}\n${r.f.phase}`}>
									<div class="mono small nowrap" style:color={x.color}><span class="micro">{x.glyph}</span> {x.text}</div>
								</td>
							{/each}
						</tr>
					{/each}
				{/each}
			</tbody>
		</table>
	</div>
	<div class="note">
		Browser columns show the first version with the feature enabled by default. Runtime columns use each runtime's default build. Engine-level
		support (V8, SpiderMonkey, JavaScriptCore) follows its browser. Illustrative data — verify before relying on it.
	</div>
{:else if ui.compatView === 'tests'}
	<div class="legend">
		<span class="kicker">Availability</span>
		<span>● enabled by default</span><span>⚑ requires flag (tested with flag)</span><span>— unavailable</span><span>? unknown</span><span>· not run</span>
		<span class="kicker ml">Results</span>
		<span class="lg"><span class="sbar" style:background="var(--st-pass)"></span>passed</span>
		<span class="lg"><span class="sbar" style:background="var(--st-fail)"></span>failed</span>
		<span class="lg"><span class="sbar" style:background="var(--st-crash)"></span>crashed</span>
		<span class="lg"><span class="sbar" style:background="var(--st-skip)"></span>skipped</span>
	</div>
	<div class="legend">Proposal pages: {@render proposalLinks()}</div>
	<div class="tbl-wrap tall">
		<table class="mx" style:min-width="1080px">
			<thead>
				<tr>
					<th class="stick th-label" style:min-width="240px">Feature family</th>
					{#each cols as c (c.id)}
						<th class="ch">
							<span class="cname"><Swatch color={c.col} bg={c.hollow ? 'transparent' : c.col} />{c.rt}</span>
							<span class="mono micro fg3">{c.ver} · {c.be}</span>
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each COMPAT as sec (sec.sec)}
					<tr class="sec">
						<td class="stick secpad">
							<div class="w6">{sec.sec}</div>
							<div class="mono micro fg3 nowrap">{sec.suite} · counted in {sec.unit}</div>
						</td>
						{#each cols as c (c.id)}<td></td>{/each}
					</tr>
					{#each sec.fams as f (f.id)}
						{@const open = !!ui.compatOpen[f.id]}
						<tr>
							<td class="stick fname">
								<div class="fam-line">
									<button class="fam" aria-expanded={open} onclick={() => (ui.compatOpen = { ...ui.compatOpen, [f.id]: !open })}>
										<span class="mono caret">{open ? '▾' : '▸'}</span><span class="w5">{f.name}</span>
									</button>
									{#if f.page}<a class="link-quiet small" href="/{f.page}">feature page</a>{/if}
								</div>
								<div class="mono micro fg3 indent">{n0(f.total)} {sec.unit}</div>
							</td>
							{#each cols as c (c.id)}
								{@const ci = CFG.indexOf(c)}
								{@const x = isOff(ui.scope, c.id) ? offCell : cellView(compatCell(f.total, f.r[ci]))}
								<td class="p0">
									<button
										class="tcell hoverbg"
										style:color={x.color}
										onclick={() => (ui.drawer = { type: 'compat', fam: f.id, cid: c.id })}
										data-tip={`${f.name} — ${c.rt} ${c.be}\n${[x.text, x.sub].filter(Boolean).join(' · ')}\nClick for failing tests & diagnostics`}
									>
										<span class="tl mono"><span class="glyph">{x.glyph}</span>{x.text}</span>
										<span class="sbar-row">{#each x.segs as g, k (k)}<span style:width={g.w} style:background={g.c}></span>{/each}</span>
										<span class="micro nowrap" style:color={x.subColor}>{x.sub}</span>
									</button>
								</td>
							{/each}
						</tr>
						{#if open}
							{@const per = cols.map((c) => kidCells(f, CFG.indexOf(c)))}
							{#each f.kids as [name], ki (name)}
								<tr>
									<td class="stick kid">{name}</td>
									{#each cols as c, k (c.id)}
										{@const x = cellView(per[k][ki])}
										<td class="p0">
											<button
												class="kcell hoverbg mono"
												style:color={x.color}
												onclick={() => (ui.drawer = { type: 'compat', fam: f.id, kid: ki, cid: c.id })}
												data-tip={`${name} — ${c.rt} ${c.be}\n${[x.text, x.sub].filter(Boolean).join(' · ')}\nClick for failing tests & diagnostics`}
											>
												<span>{x.text}</span><span class="micro" style:color={x.subColor}>{x.sub}</span>
											</button>
										</td>
									{/each}
								</tr>
							{/each}
						{/if}
					{/each}
				{/each}
			</tbody>
		</table>
	</div>
{:else}
	<div class="s12 fg3">{PERF_NOTE[ui.perfMetric]}</div>
	<div class="tbl-wrap tall">
		<table class="mx" style:min-width="1000px">
			<thead>
				<tr>
					<th class="stick th-label" style:min-width="240px">Proposal / extension · corpus</th>
					{#each cols as c (c.id)}
						<th class="ch r">
							<span class="cname jr"><Swatch color={c.col} bg={c.hollow ? 'transparent' : c.col} />{c.rt}</span>
							<div class="mono micro fg3">{c.be}</div>
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each perfSecs as sec (sec.sec)}
					<tr class="sec">
						<td class="stick secname">{sec.sec}</td>
						{#each cols as c (c.id)}<td></td>{/each}
					</tr>
					{#each sec.rows as r (r.f.id)}
						<tr>
							<td class="stick fname">
								<div class="fam-line">
									<span class="w5">{r.f.name}</span>
									{#if r.f.page}<a class="link-quiet small" href="/{r.f.page}">feature page</a>{/if}
								</div>
								<div class="mono micro fg3">{r.corpus}</div>
							</td>
							{#each r.cells as x, k (k)}
								<td
									class="pcell r"
									style:background={x.bg}
									style:color={x.color}
									data-tip={`${r.f.name} — ${cols[k].rt} ${cols[k].be}\n${[x.text, x.sub].filter(Boolean).join(' · ')}`}
								>
									<div class="mono s12 nowrap" style:font-weight={x.fw}>{x.text}</div>
									<div class="micro fg3 nowrap">{x.sub}</div>
								</td>
							{/each}
						</tr>
					{/each}
				{/each}
			</tbody>
		</table>
	</div>
	<div class="note">
		Bold = lowest in row · heat = distance from row's lowest · ⚑ measured with the feature flag enabled · runtimes failing the corpus correctness
		check get no value.
	</div>
{/if}

<style>
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 6px 16px;
	}
	.path {
		width: 100%;
	}
	h1 {
		font-size: 18px;
		font-weight: 600;
	}
	.s12 {
		font-size: 12px;
	}
	.lim {
		max-width: 760px;
	}
	.w4 {
		font-weight: 400;
	}
	.w5 {
		font-weight: 500;
	}
	.w6 {
		font-weight: 600;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 16px;
		font-size: 12px;
		color: var(--fg2);
		align-items: center;
	}
	.lg {
		display: flex;
		align-items: center;
		gap: 5px;
	}
	.box {
		width: 12px;
		height: 12px;
	}
	.sbar {
		width: 10px;
		height: 6px;
	}
	.ml {
		margin-left: 8px;
	}
	.plink {
		font-size: 12px;
		text-decoration: underline;
	}
	.tall {
		max-height: 76vh;
	}
	.fh {
		padding: 6px 8px;
		text-align: center;
		font-size: 12px;
	}
	.secname {
		padding: 6px 12px;
		font-weight: 600;
		background: var(--bg3) !important;
	}
	.secpad {
		padding: 8px 12px;
		background: var(--bg3) !important;
	}
	.fname {
		padding: 6px 12px;
	}
	.fcell {
		padding: 6px;
		text-align: center;
	}
	.ch {
		padding: 6px 10px;
		text-align: left;
	}
	.cname {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
	}
	.jr {
		display: inline-flex;
	}
	.fam-line {
		display: flex;
		gap: 8px;
		align-items: baseline;
		flex-wrap: wrap;
	}
	.fam {
		display: flex;
		gap: 8px;
		align-items: baseline;
		text-align: left;
	}
	.caret {
		width: 10px;
	}
	.indent {
		padding-left: 18px;
	}
	.p0 {
		padding: 0;
	}
	.tcell {
		display: flex;
		flex-direction: column;
		gap: 3px;
		width: 100%;
		padding: 6px 10px;
		text-align: left;
	}
	.tl {
		display: flex;
		gap: 6px;
		align-items: baseline;
		font-size: 12px;
		white-space: nowrap;
	}
	.glyph {
		width: 10px;
		color: var(--fg2);
	}
	.sbar-row {
		display: flex;
		height: 4px;
		width: 100%;
		background: var(--bg3);
	}
	.kid {
		padding: 4px 12px 4px 38px;
		font-size: 12px;
		color: var(--fg2);
	}
	.kcell {
		display: flex;
		justify-content: space-between;
		gap: 6px;
		width: 100%;
		padding: 4px 10px;
		text-align: left;
		font-size: 11px;
	}
	.pcell {
		padding: 6px 10px;
	}
</style>
