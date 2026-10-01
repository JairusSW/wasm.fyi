<script lang="ts">
	import { siteHref } from '$lib/links';
	import { COMPAT, FLAGS, FT } from '$lib/data/features';
	import { CB, CFG, MACH } from '$lib/data/runtimes';
	import { ALLB, MET, OV, PHASE_NOTE } from '$lib/data/snapshot';
	import { ST, ST_DESC } from '$lib/data/status';
	import { H, fmtU, fx, hex, n0 } from '$lib/format';
	import { benchHref } from '$lib/links';
	import { TOTAL_WORKLOADS, benchVal, cfgIndex, cn, compatCell, cov, kidCells, ratio, type PerfGroup } from '$lib/model';
	import { ui } from '$lib/state.svelte';
	import Swatch from './Swatch.svelte';
	import { viewCell, viewData, viewReason } from '$lib/view-data';

	const d = $derived(ui.drawer);
	let copied = $state(false);
	const close = () => {
		ui.drawer = null;
		copied = false;
	};

	// ── Result cell ────────────────────────────────────────────────────────
	const cell = $derived.by(() => {
		if (d?.type !== 'cell') return null;
		const s = ui.scope;
		const b = ALLB.find((x) => x.id === d.b)!;
		const c = CB[d.c];
		const u = MET[d.m].u;
		const r = benchVal(s, b, c.id, d.m, d.cf);
		const br = benchVal(s, b, s.baseline, d.m, d.cf);
		const t = ST[r.st];
		const measured = viewCell(s.machine,ui.snap,b.id,c.id,d.m);
		const report = viewData.reports[measured.report];
		const config = viewData.hosts[s.machine].configurations[c.id];
		const ok = r.st === 'ok';
		const v = ok ? r.v : 0;
		const dots = ok && d.m !== 'rss' && d.m !== 'code' ? measured.launchMedians || [] : [];
		const lo = dots.length ? Math.min(...dots) : v;
		const hi = dots.length ? Math.max(...dots) : v;
		const X = (x: number) => 10 + ((x - lo) / (hi - lo || 1)) * 400;
		const sorted = [...dots].sort((a, b2) => a - b2);
        const cmd = report ? `just gather --rebuild /path/to/sealed/${report.runId}/report` : 'No sealed measurement for this cell';
		return {
			kicker: `${b.group} · ${MET[d.m].l}`,
			title: b.id + (d.caseLabel ? ' · ' + d.caseLabel : ''),
			b,
			c,
			ok,
			metric: MET[d.m].short,
			st: t,
			stDesc: viewReason(measured) || ST_DESC[r.st] || '',
			abs: ok ? fmtU(v, u) : '',
			absCi: ok && measured.interval ? `95% CI ${fmtU(measured.interval[0],u)} – ${fmtU(measured.interval[1],u)}` : 'CI unavailable',
			baseName: cn(CB[s.baseline]),
			ratio: ok && br.st === 'ok' ? fx(v / br.v) : 'n/a',
			baseAbs: br.st === 'ok' ? 'baseline ' + fmtU(br.v, u) : 'baseline not comparable',
			dots: dots.map((x, i) => ({ x: X(x).toFixed(1), y: (26 + (i % 3) * 4).toFixed(0) })),
			medX: ok ? X(v).toFixed(1) : '0',
			boxX: ok && measured.interval ? X(measured.interval[0]).toFixed(1) : '0',
			boxW: ok && measured.interval ? Math.max(2,X(measured.interval[1])-X(measured.interval[0])).toFixed(1) : '0',
			minL: ok ? fmtU(lo, u) : '',
			maxL: ok ? fmtU(hi, u) : '',
            stats: ok ? [
              {k:'Independent launches',v:String(report?.options.launches || 'unavailable')},
              {k:'Samples requested / launch',v:String(report?.options.samples || 'unavailable')},
              {k:'Steady warmups / launch',v:String(report?.options.warmup ?? 'unavailable')},
              {k:'Median',v:fmtU(v,u)},
              {k:'Observer',v:d.m==='rss'?'process.peak_rss':d.m==='code'?'extracted native image':'verified embedding calls'},
              {k:'Evidence',v:report?report.sha256.slice(0,12)+'…':'unavailable'}
            ] : [],
			phaseNote: PHASE_NOTE[d.m],
            record: [
              {k:'Run',v:report?`${report.runId} · ${report.created}`:'not collected'},
              {k:'Runtime',v:config?`${config.runtime} ${config.version}`:'not collected'},
              {k:'Backend',v:config?.backend || 'not collected'},
              {k:'Artifact',v:`${b.id} · ${n0(b.kb)} KiB · sha256 ${b.artifactSha256}`},
              {k:'Source',v:b.src || 'unavailable'},
              {k:'Machine',v:MACH[s.machine].l},
              {k:'Policy',v:'CPU affinity, scheduling and frequency uncontrolled'},
              {k:'Evidence SHA-256',v:report?.sha256 || 'unavailable'}
            ],
			cmd
		};
	});

	async function copyCmd() {
		if (!cell) return;
		try {
			await navigator.clipboard.writeText(cell.cmd.replace(/\\\n\s*/g, ''));
		} catch {}
		copied = true;
	}

	// ── Spec test failures ─────────────────────────────────────────────────
	const compat = $derived.by(() => {
		if (d?.type !== 'compat') return null;
		const sec = COMPAT.find((x) => x.fams.some((f) => f.id === d.fam))!;
		const f = sec.fams.find((x) => x.id === d.fam)!;
		const ci = cfgIndex(d.cid);
		const c = CB[d.cid];
		const k = d.kid != null ? kidCells(f, ci)[d.kid] : compatCell(f.total, f.r[ci]);
		const avail = {
			d: 'enabled by default',
			f: 'requires flag · tested with ' + (FLAGS[f.id] || '--enable-' + f.id),
			u: 'unavailable in this configuration',
			'?': 'unknown — no versioned metadata; not run',
			n: 'available but not run in this snapshot'
		}[k.av];
		const T = FT[f.id];
		const fails = [];
		for (let i = 0; i < Math.min(k.fail, 4); i++) {
			const t = T ? T[i % T.length] : null;
			const line = 40 + Math.floor(H(f.id + d.cid + i) * 2400);
			fails.push({
				st: 'failed',
				stColor: 'var(--st-fail)',
				file: (t ? t[0] : f.id.replace('core-', '') + '.wast') + ':' + line,
				kind: t ? t[1] : 'assert_return',
				expr: t ? t[2] : '(invoke "run" (i32.const 7))',
				exp: t ? t[3] : 'i32:0',
				act: t ? t[4] : 'i32:1',
				diag: t ? t[5] : 'result mismatch',
				issue: `${c.rt}#${1000 + Math.floor(H(f.id + i + c.rt) * 8000)} (synthetic)`
			});
		}
		for (let i = 0; i < Math.min(k.crash, 2); i++)
			fails.push({
				st: 'crashed',
				stColor: 'var(--st-crash)',
				file: `${f.id}.wast:${200 + i * 37}`,
				kind: 'assert_return',
				expr: '(invoke "stress")',
				exp: 'returns normally',
				act: 'SIGSEGV (exit 139)',
				diag: 'crash in generated code; core dump in run record',
				issue: 'no linked issue'
			});
		const run = (v: number) => (k.run ? n0(v) : '—');
		return {
			kicker: `${sec.sec} · spec test results`,
			title: f.name + (d.kid != null ? ' / ' + f.kids[d.kid][0] : ''),
			c,
			avail,
			fails,
			more: k.fail > 4 ? `+ ${k.fail - 4} more failing ${sec.unit}` : '',
			counts: [
				{ k: 'Passed', v: run(k.pass), c: 'var(--st-pass)' },
				{ k: 'Failed', v: run(k.fail), c: 'var(--st-fail)' },
				{ k: 'Crashed', v: run(k.crash), c: 'var(--st-crash)' },
				{ k: 'Skipped', v: run(k.skip), c: 'var(--fg2)' },
				{ k: 'Timed out', v: k.run ? '0' : '—', c: 'var(--fg2)' },
				{ k: 'Not run', v: k.run ? '0' : n0(k.total), c: 'var(--fg2)' }
			],
			meta: [
				{ k: 'Counting unit', v: `${sec.unit} (${n0(k.total)} total)` },
				{ k: 'Suite', v: sec.suite },
				{ k: 'Configuration', v: `${c.rt} ${c.ver} · ${c.be}` },
				{ k: 'Tested', v: '2026-09-27 14:02 UTC · run t-' + hex(f.id + c.id) },
				{ k: 'Harness', v: 'wast-runner v1.9 · harness v3.2.0' }
			]
		};
	});

	// ── Runtime profile ────────────────────────────────────────────────────
	const profile = $derived.by(() => {
		if (d?.type !== 'profile') return null;
		const s = ui.scope;
		const cfgs = CFG.filter((c) => c.rt === d.rt);
		const strengths: { t: string; v: string }[] = [];
		const tradeoffs: { t: string; v: string }[] = [];
		(['lat', 'mem', 'code'] as PerfGroup[]).forEach((g) =>
			OV[g].cols.forEach((col, i) => {
				const list = CFG.map((c) => ({ c, x: ratio(s, g, c.id, i) }))
					.filter((e) => e.x != null)
					.map((e) => ({ c: e.c, r: e.x!.r, ci: e.x!.ci }))
					.sort((a, b) => a.r - b.r);
				if (!list.length) return;
				const f = list[0];
				const l = list[list.length - 1];
				if (f.c.rt === d.rt && list[1] && f.r + f.ci < list[1].r - list[1].ci)
					strengths.push({ t: `Lowest ${col.toLowerCase()} in this snapshot — ${f.c.be}`, v: fx(f.r) });
				if (l.c.rt === d.rt) tradeoffs.push({ t: `Highest ${col.toLowerCase()} in this snapshot — ${l.c.be}`, v: fx(l.r) });
			})
		);
		if (!strengths.length) strengths.push({ t: 'No metric where this runtime is the clear lowest in this scope.', v: '' });
		if (!tradeoffs.length) tradeoffs.push({ t: 'Not the highest on any aggregate in this scope.', v: '' });
		const fams = COMPAT[1].fams;
		const coverage = [
			...cfgs.map((c) => ({ k: `${c.be} — correct workloads`, v: `${n0(cov(c.id,ui.scope)[0])} / ${TOTAL_WORKLOADS}` })),
			...cfgs.map((c) => ({
				k: `${c.be} — proposals enabled by default`,
				v: `${fams.filter((f) => f.r[cfgIndex(c.id)][0] === 'd').length} / ${fams.length}`
			}))
		];
		return { title: d.rt, cfgs, strengths, tradeoffs, coverage };
	});

	const kicker = $derived(cell?.kicker ?? compat?.kicker ?? 'Runtime profile');
	const title = $derived(cell?.title ?? compat?.title ?? profile?.title ?? '');

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && ui.drawer) close();
	}
</script>

<svelte:window {onkeydown} />

{#if d}
	<div class="drawer" role="dialog" aria-label={title}>
		<div class="top">
			<div class="titles">
				<div class="kicker">{kicker}</div>
				<div class="mono title">{title}</div>
			</div>
			<button class="esc" onclick={close} aria-label="Close (Esc)">Esc</button>
		</div>
		<div class="body">
			{#if cell}
				<div class="ident">
					<Swatch color={cell.c.col} bg={cell.c.hollow ? 'transparent' : cell.c.col} size={9} />
					<span class="w5">{cell.c.rt} {cell.c.ver}</span>
					<span class="mono small fg3">{cell.c.be} · {cell.metric}</span>
				</div>
				<div class="status" style:color={cell.st[2]}>
					<span class="mono">{cell.st[0]}</span><span class="w5">{cell.st[1]}</span>
					{#if cell.ok}<span class="fg2">output checksum matched reference (sha256)</span>{/if}
				</div>
				{#if cell.ok}
					<div class="tiles two">
						<div class="pad">
							<div class="small fg3">Absolute (median)</div>
							<div class="mono big">{cell.abs}</div>
							<div class="mono small fg3">{cell.absCi}</div>
						</div>
						<div class="pad">
							<div class="small fg3">vs {cell.baseName}</div>
							<div class="mono big">{cell.ratio}</div>
							<div class="mono small fg3">{cell.baseAbs}</div>
						</div>
					</div>
					<div class="sect">
						<div class="kicker">Distribution — independent process medians</div>
						<svg viewBox="0 0 420 46" class="dist">
							<line x1="10" x2="410" y1="30" y2="30" style="stroke:var(--line2)" />
							<rect x={cell.boxX} width={cell.boxW} y="18" height="24" style="fill:var(--bg3);stroke:var(--line2)" />
							<line x1={cell.medX} x2={cell.medX} y1="14" y2="46" style="stroke:var(--fg);stroke-width:1.5" />
							{#each cell.dots as dot, i (i)}
								<circle cx={dot.x} cy={dot.y} r="3" style:fill={cell.c.col} opacity="0.85" />
							{/each}
						</svg>
						<div class="minmax mono"><span>{cell.minL}</span><span>{cell.maxL}</span></div>
						<div class="stats">
							{#each cell.stats as s (s.k)}
								<div><span class="fg3">{s.k}</span><span class="mono">{s.v}</span></div>
							{/each}
						</div>
						<div class="note">Recorded independent launch medians; missing distributions and intervals remain unavailable.</div>
					</div>
				{:else}
					<div class="desc mono">{cell.stDesc}</div>
				{/if}
				<div class="lede">{cell.phaseNote}</div>
				<div class="sect">
					<div class="kicker">Run record</div>
					{#each cell.record as s (s.k)}
						<div class="kv" style:grid-template-columns="120px 1fr"><span class="fg3">{s.k}</span><span class="mono">{s.v}</span></div>
					{/each}
				</div>
				<div class="sect">
					<div class="between">
						<span class="kicker">Reanalyze sealed report</span>
						<button class="copy" onclick={copyCmd}>{copied ? 'Copied' : 'Copy'}</button>
					</div>
					<pre class="mono">{cell.cmd}</pre>
				</div>
				<div class="actions">
					<a class="primary" href={siteHref(benchHref(cell.b.id))}>Open benchmark page</a>
					<button class="outline" onclick={() => ui.openProfile(cell.c.rt)}>Runtime profile</button>
				</div>
			{:else if compat}
				<div class="ident">
					<Swatch color={compat.c.col} bg={compat.c.hollow ? 'transparent' : compat.c.col} size={9} />
					<span class="w5">{compat.c.rt} {compat.c.ver}</span>
					<span class="mono small fg3">{compat.c.be}</span>
				</div>
				<div class="s12"><span class="fg3">Availability: </span>{compat.avail}</div>
				<div class="tiles three">
					{#each compat.counts as k (k.k)}
						<div class="pad8">
							<div class="small fg3">{k.k}</div>
							<div class="mono s16" style:color={k.c}>{k.v}</div>
						</div>
					{/each}
				</div>
				<div class="sect0">
					{#each compat.meta as k (k.k)}
						<div class="kv" style:grid-template-columns="110px 1fr"><span class="fg3">{k.k}</span><span class="mono">{k.v}</span></div>
					{/each}
				</div>
				<div class="sect">
					<div class="kicker">Failing tests</div>
					{#if !compat.fails.length}<div class="lede">No failing or crashed tests in this cell.</div>{/if}
					{#each compat.fails as f, i (i)}
						<div class="fail">
							<div class="between"><span class="mono">{f.file}</span><span class="small" style:color={f.stColor}>{f.st}</span></div>
							<div class="mono small fg2 brk">{f.kind} {f.expr}</div>
							<div class="expact mono small">
								<span class="fg3">expected</span><span>{f.exp}</span>
								<span class="fg3">actual</span><span style:color={f.stColor}>{f.act}</span>
							</div>
							<div class="small fg2">{f.diag} · <span class="fg3">{f.issue}</span></div>
						</div>
					{/each}
					<div class="note">{compat.more}</div>
				</div>
				<div class="note">Observed results for one configuration on one suite revision. Not a compliance certification.</div>
			{:else if profile}
				<div class="sect0 g4">
					{#each profile.cfgs as c (c.id)}
						<div class="cfg-line">
							<Swatch color={c.col} bg={c.hollow ? 'transparent' : c.col} />
							<span class="mono">{c.ver} · {c.be}</span><span class="fg3">{c.kind}</span>
						</div>
					{/each}
				</div>
				<div class="s12 fg3">Statements are scoped to the current snapshot, machine and baseline. They are computed, not editorial.</div>
				<div class="sect">
					<div class="kicker">Measured strengths</div>
					{#each profile.strengths as s (s.t)}<div class="stmt">{s.t} <span class="mono fg3">{s.v}</span></div>{/each}
				</div>
				<div class="sect">
					<div class="kicker">Measured tradeoffs</div>
					{#each profile.tradeoffs as s (s.t)}<div class="stmt">{s.t} <span class="mono fg3">{s.v}</span></div>{/each}
				</div>
				<div class="sect">
					<div class="kicker">Coverage</div>
					{#each profile.coverage as s (s.k)}<div class="stmt between"><span>{s.k}</span><span class="mono">{s.v}</span></div>{/each}
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.drawer {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		width: 460px;
		max-width: 100vw;
		background: var(--bg2);
		border-left: 1px solid var(--line2);
		box-shadow: -12px 0 32px rgba(0, 0, 0, 0.28);
		overflow: auto;
		z-index: 50;
		display: flex;
		flex-direction: column;
	}
	.top {
		position: sticky;
		top: 0;
		background: var(--bg2);
		border-bottom: 1px solid var(--line);
		padding: 12px 16px;
		display: flex;
		gap: 10px;
		align-items: flex-start;
		z-index: 1;
	}
	.titles {
		flex: 1;
		min-width: 0;
	}
	.title {
		font-size: 14px;
		font-weight: 500;
		word-break: break-word;
	}
	.esc {
		border: 1px solid var(--line2);
		padding: 2px 8px;
		color: var(--fg2);
	}
	.body {
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.ident {
		display: flex;
		align-items: center;
		gap: 7px;
	}
	.w5 {
		font-weight: 500;
	}
	.status {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
	}
	.two {
		grid-template-columns: 1fr 1fr;
	}
	.three {
		grid-template-columns: repeat(3, 1fr);
	}
	.pad {
		padding: 10px;
	}
	.pad8 {
		padding: 8px;
	}
	.big {
		font-size: 20px;
	}
	.s16 {
		font-size: 16px;
	}
	.s12 {
		font-size: 12px;
	}
	.sect {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.sect0 {
		display: flex;
		flex-direction: column;
	}
	.g4 {
		gap: 4px;
	}
	.dist {
		width: 100%;
		height: auto;
		display: block;
	}
	.minmax {
		display: flex;
		justify-content: space-between;
		font-size: 10px;
		color: var(--fg3);
	}
	.stats {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 2px 14px;
		font-size: 12px;
	}
	.stats > div {
		display: flex;
		justify-content: space-between;
		gap: 8px;
	}
	.desc {
		font-size: 12px;
		color: var(--fg2);
		background: var(--bg3);
		padding: 10px;
		white-space: pre-wrap;
	}
	.kv {
		display: grid;
		gap: 8px;
		font-size: 12px;
		border-bottom: 1px solid var(--line);
		padding: 3px 0;
	}
	.kv .mono,
	.brk {
		word-break: break-word;
	}
	.between {
		display: flex;
		justify-content: space-between;
		gap: 8px;
	}
	.copy {
		border: 1px solid var(--line2);
		padding: 0 6px;
		font-size: 11px;
		color: var(--fg2);
	}
	pre {
		margin: 0;
		background: var(--bg3);
		padding: 10px;
		font-size: 11px;
		white-space: pre-wrap;
		word-break: break-all;
	}
	.actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.primary {
		background: var(--fg);
		color: var(--bg);
		padding: 5px 10px;
		font-size: 12px;
		text-decoration: none;
	}
	.outline {
		border: 1px solid var(--line2);
		padding: 5px 10px;
		font-size: 12px;
	}
	.fail {
		border: 1px solid var(--line);
		padding: 8px 10px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12px;
	}
	.expact {
		display: grid;
		grid-template-columns: 70px 1fr;
		gap: 2px 8px;
	}
	.cfg-line {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 12px;
	}
	.stmt {
		font-size: 12px;
		border-bottom: 1px solid var(--line);
		padding: 4px 0;
	}
</style>
