<script lang="ts">
	import RtLabel from '$lib/components/RtLabel.svelte';
	import Seg from '$lib/components/Seg.svelte';
	import { CFG } from '$lib/data/runtimes';
	import { XW } from '$lib/data/snapshot';
	import type { Cfg } from '$lib/data/types';
	import { fmtU, n0, pc } from '$lib/format';
	import { isOff } from '$lib/model';
	import { ui } from '$lib/state.svelte';

	// Phase vector per config: [compile, instantiate, first call, steady per call, cached load, tier-up calls?, pre-tier per call?]
	type Phases = (number | null)[];

	const W = 520;
	const HC = 250;
	const pl = 50;
	const pr = 10;
	const pt = 12;
	const pb = 28;

	const n = $derived(Math.max(1, Math.round(Math.pow(10, ui.xLog))));
	const stead = (a: Phases, k: number) => {
		const [, , , per, , tier, pre] = a as number[];
		return tier ? Math.min(k, tier) * pre + Math.max(0, k - tier) * per : k * per;
	};
	const total = (a: Phases, k: number): number | null => {
		const [comp, inst, first, , cached] = a as number[];
		if (ui.xReuse === 'single') return comp + inst + first + stead(a, k - 1);
		if (ui.xReuse === 'cached') return a[4] == null ? null : cached + inst + first + stead(a, k - 1);
		return comp + k * (inst + first);
	};

	const model = $derived.by(() => {
		const W0 = XW[ui.xWork];
		const excluded: { c: Cfg; why: string }[] = [];
		const live: { c: Cfg; a: Phases }[] = [];
		for (const c of CFG) {
			const a = W0[c.id];
			if (isOff(ui.scope, c.id)) excluded.push({ c, why: 'unavailable on this machine' });
			else if (!a) excluded.push({ c, why: 'failed correctness on this workload — no performance credit' });
			else if (total(a, 1) == null) excluded.push({ c, why: 'no supported cached-artifact workflow' });
			else live.push({ c, a });
		}
		const now = live.map((x) => ({ ...x, t: total(x.a, n)! })).sort((a, b) => a.t - b.t);
		const tmin = now[0].t;
		const tmax = now[now.length - 1].t;
		const bars = now.map((x, i) => ({
			c: x.c,
			rank: i + 1,
			w: (8 + 92 * (Math.log(x.t / tmin) / (Math.log(tmax / tmin) || 1))).toFixed(1) + '%',
			text: fmtU(x.t, 'ms')
		}));
		const grid = Array.from({ length: 61 }, (_, i) => Math.max(1, Math.round(Math.pow(10, i / 10))));
		const allT = live.flatMap((x) => [total(x.a, 1)!, total(x.a, 1e6)!]);
		const lo = Math.log10(Math.min(...allT));
		const hi = Math.log10(Math.max(...allT));
		const X = (k: number) => pl + (Math.log10(k) / 6) * (W - pl - pr);
		const Y = (t: number) => pt + (1 - (Math.log10(t) - lo) / (hi - lo)) * (HC - pt - pb);
		const lines = live.map((x) => ({ c: x.c, p: grid.map((k) => X(k).toFixed(1) + ',' + Y(total(x.a, k)!).toFixed(1)).join(' ') }));
		const yTicks = [];
		for (let e = Math.ceil(lo); e <= hi; e++) yTicks.push({ y: Y(10 ** e).toFixed(1), t: pc(Y(10 ** e), HC), label: fmtU(10 ** e, 'ms') });
		const xTicks = [0, 1, 2, 3, 4, 5, 6].map((e) => ({ l: pc(X(10 ** e), W), label: e === 0 ? '1' : '10' + '⁰¹²³⁴⁵⁶'[e] }));
		const cross: { n: string; c: Cfg }[] = [];
		let prev: Cfg | null = null;
		for (let k = 0; k <= 600; k++) {
			const nn = Math.max(1, Math.round(Math.pow(10, k / 100)));
			const L = live.map((x) => ({ c: x.c, t: total(x.a, nn)! })).sort((a, b) => a.t - b.t)[0];
			if (!prev || L.c.id !== prev.id) {
				cross.push({ n: nn === 1 ? 'from 1 call' : '≈ ' + n0(nn) + ' calls', c: L.c });
				prev = L.c;
			}
		}
		return { bars, lines, yTicks, xTicks, curX: X(n).toFixed(1), cross, excluded };
	});

	const formula = $derived(
		ui.xReuse === 'single'
			? 'total = compile + instantiate + first call + Σ per-call time (calls 2…n)'
			: ui.xReuse === 'shared'
				? 'total = compile + n × (instantiate + first call)'
				: 'total = load cached artifact + instantiate + first call + Σ per-call time (calls 2…n)'
	);
</script>

<svelte:head>
	<title>Compare — startup vs throughput · wasm.fyi</title>
</svelte:head>

<div class="head">
	<h1>Compare — startup vs throughput</h1>
	<span class="badge mono">MODEL · estimated from measured phases, not a measured end-to-end result</span>
</div>
<div class="row">
	<Seg
		options={[
			['markdown-parse', 'markdown-parse'],
			['js-interp/richards', 'js-interp/richards']
		]}
		value={ui.xWork}
		onselect={(v) => (ui.xWork = v)}
		mono
		label="Workload"
	/>
	<Seg
		options={[
			['single', 'One instance, many calls'],
			['shared', 'Fresh instance per call · shared module'],
			['cached', 'Cached compiled artifact']
		]}
		value={ui.xReuse}
		onselect={(v) => (ui.xReuse = v as typeof ui.xReuse)}
		label="Reuse"
	/>
</div>
<div class="panel ctl">
	<label class="slider">
		<span class="kicker nowrap">Invocations</span>
		<input type="range" min="0" max="6" step="0.05" bind:value={ui.xLog} aria-label="Number of invocations (log scale)" />
		<span class="mono nval">{n0(n)}</span>
	</label>
	<code class="mono formula">{formula}</code>
</div>
<div class="cards">
	<div class="card">
		<div><div class="card-title">Estimated total at {n0(n)} calls</div><div class="note">ranked · bar length on log scale</div></div>
		{#each model.bars as b (b.c.id)}
			<div class="brow">
				<span class="mono small fg3">{b.rank}</span>
				<RtLabel c={b.c} />
				<span class="bar" style:width={b.w} style:background={b.c.col}></span>
				<span class="mono r">{b.text}</span>
			</div>
		{/each}
	</div>
	<div class="card g6">
		<div><div class="card-title">Total vs invocations</div><div class="note">log–log · vertical line = current setting</div></div>
		<div class="chart">
			<svg viewBox="0 0 {W} {HC}">
				{#each model.yTicks as t (t.y)}<line x1="50" x2="510" y1={t.y} y2={t.y} style="stroke:var(--line)" />{/each}
				<line x1={model.curX} x2={model.curX} y1="12" y2="222" style="stroke:var(--fg2);stroke-dasharray:3 3" />
				{#each model.lines as l (l.c.id)}
					<polyline points={l.p} style:stroke={l.c.col} style:stroke-dasharray={l.c.hollow ? '4 3' : 'none'} class="ln" />
				{/each}
			</svg>
			{#each model.yTicks as t (t.y)}<span class="axis-label" style:left="8.5%" style:top={t.t} style:transform="translate(-100%,-50%)">{t.label}</span>{/each}
			{#each model.xTicks as t (t.l)}<span class="axis-label" style:left={t.l} style:top="93%" style:transform="translateX(-50%)">{t.label}</span>{/each}
		</div>
	</div>
</div>
<div class="cards narrow">
	<div class="list">
		<div class="kicker">Where the lowest-total choice changes</div>
		{#each model.cross as c, i (i)}
			<div class="li"><span class="mono fg2 n">{c.n}</span><RtLabel c={c.c} /></div>
		{/each}
	</div>
	<div class="list">
		<div class="kicker">Excluded from this model</div>
		{#each model.excluded as c (c.c.id)}
			<div class="li"><RtLabel c={c.c} /><span class="fg2 why">{c.why}</span></div>
		{/each}
		<div class="note mt4">
			v8 tiered uses its observed per-call curve (slower until tier-up), not a constant steady-state estimate. Medians are summed; the sum is not a
			percentile.
		</div>
	</div>
</div>

<style>
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 6px 16px;
	}
	h1 {
		font-size: 16px;
		font-weight: 600;
	}
	.badge {
		font-size: 11px;
		color: var(--st-warn);
		border: 1px solid var(--st-warn);
		padding: 0 6px;
	}
	.ctl {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 16px;
		align-items: center;
		padding: 10px 14px;
	}
	.slider {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: 1 1 320px;
	}
	input[type='range'] {
		flex: 1;
		accent-color: var(--fg2);
	}
	.nval {
		font-size: 16px;
		min-width: 90px;
		text-align: right;
	}
	.formula {
		font-size: 11px;
		color: var(--fg2);
		flex: 1 1 360px;
	}
	.brow {
		display: grid;
		grid-template-columns: 18px 130px 1fr 80px;
		gap: 8px;
		align-items: center;
		font-size: 12px;
	}
	.bar {
		height: 8px;
		opacity: 0.85;
	}
	.g6 {
		gap: 6px;
	}
	.chart {
		position: relative;
	}
	svg {
		width: 100%;
		height: auto;
		display: block;
	}
	.ln {
		fill: none;
		stroke-width: 1.6;
	}
	.narrow {
		grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr));
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.li {
		display: flex;
		gap: 10px;
		align-items: center;
		font-size: 12px;
		border-bottom: 1px solid var(--line);
		padding: 4px 0;
	}
	.n {
		min-width: 130px;
	}
	.why {
		margin-left: auto;
		text-align: right;
	}
	.mt4 {
		margin-top: 4px;
	}
</style>
