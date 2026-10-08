<script lang="ts">
 import ReportFiles from './ReportFiles.svelte';
 import {sourceNumber} from '$lib/api/presentation';
 import {currentClient} from '$lib/api/controller.svelte';
 import type {WireRecord,ResultData} from '$lib/api/types';
 import {sampleDistribution} from '$lib/sample-distribution';
 import {shortVersion} from '$lib/version-identity';
 import VersionLink from './VersionLink.svelte';
 import { configVersion } from '$lib/data/runtimes';
	import { siteHref } from '$lib/links';
	import { COMPAT, FLAGS, FT } from '$lib/data/features';
	import { CB, CFG, MACH } from '$lib/data/runtimes';
	import { ALLB, MET, OV, PHASE_NOTE } from '$lib/data/snapshot';
	import type { MetricKey } from '$lib/data/types';
	import { ST, ST_DESC } from '$lib/data/status';
	import { fmtU, relative, n0, workloadName } from '$lib/format';
	import { benchHref, href } from '$lib/links';
	import { configIdentity } from '$lib/data/runtimes';
	import { totalWorkloads, benchVal, isVisible, compileExcluded, cfgIndex, compatCell, cov, featureContracts, featureOutcome, kidCells, ratio, type PerfGroup } from '$lib/model';
	import { ui } from '$lib/state.svelte';
	import Swatch from './Swatch.svelte';
	import { viewCell, viewData, viewReason } from '$lib/view-data';
	import { fade, fly } from 'svelte/transition';

	const d = $derived(ui.drawer);
	let copied = $state(false);
	const close = () => {
		ui.drawer = null;
		copied = false;
	};


 let detail=$state<{result:WireRecord;report:WireRecord;configuration:WireRecord;environment:WireRecord;workload:WireRecord}|null>(null);
 let detailError=$state('');let detailLoading=$state(false);let evidence=$state('');let chunk=$state('');let evidenceLoading=$state(false);
 $effect(()=>{
  const selected=ui.drawer;if(selected?.type!=='cell'){detail=null;return}
  const source=viewCell(ui.machine,ui.snap,selected.b,selected.c,selected.m);const client=currentClient();
  detail=null;detailError='';evidence='';chunk='';if(!client||!source.result)return;
  const abort=new AbortController();detailLoading=true;
  void (async()=>{
   const result=(await client.descriptor('results',source.result!,abort.signal)).record;
   const data=result.data as ResultData;
   const report=(await client.descriptor('reports',data.reportId,abort.signal)).record;
   const configuration=(await client.descriptor('configurations',data.configurationId,abort.signal)).record;
   const environment=(await client.descriptor('environments',data.environmentId,abort.signal)).record;
   const workload=(await client.descriptor('workloads',data.contractId,abort.signal)).record;
   abort.signal.throwIfAborted();detail={result,report,configuration,environment,workload};
  })().catch(error=>{if(!abort.signal.aborted)detailError=String(error)}).finally(()=>{if(!abort.signal.aborted)detailLoading=false});
  return ()=>abort.abort();
 });
 async function loadEvidence(){
  const client=currentClient();if(!client||!detail||!chunk)return;evidenceLoading=true;detailError='';
  try{const data=await client.evidence('results',detail.result.id,chunk);evidence=JSON.stringify(data,null,2);
   const diagnostic=data as {kind?:string;data?:{launch_medians?:Record<string,unknown>}};
   if(diagnostic.kind==='summary-diagnostics'&&diagnostic.data?.launch_medians){const values=Object.entries(diagnostic.data.launch_medians).sort(([a],[b])=>Number(a)-Number(b)).map(([,v])=>sourceNumber(v)!.value/1e6);const selected=ui.drawer;if(selected?.type==='cell')viewCell(ui.machine,ui.snap,selected.b,selected.c,selected.m).launchMedians=values}}catch(error){detailError=String(error)}finally{evidenceLoading=false}
 }

	type RecordRow = { k: string; v: string; tip?: string; fine?: boolean; href?: string | null; ext?: boolean; action?: () => void; copy?: string };
	type RecordGroup = { title: string; rows: RecordRow[] };
	const REPO = 'https://github.com/JairusSW/wasm.fyi';
	// Corpus workloads live in the repository as corpora/<corpus>/{artifacts,sources}/….
	function corpusHref(id: string, file: string) {
		const corpus = id.split('/')[0];
		return ['applications', 'features'].includes(corpus) && id.includes('/') ? `${REPO}/blob/main/corpora/${corpus}/${file}` : null;
	}
	function fmtSpread(cv: number) {
		const pct = cv * 100;
		return pct < 0.1 ? '<0.1%' : `±${pct.toFixed(pct < 10 ? 1 : 0)}%`;
	}
	let copiedKey = $state('');
	async function copyValue(key: string, value: string) {
		try {
			await navigator.clipboard.writeText(value);
			copiedKey = key;
			setTimeout(() => copiedKey === key && (copiedKey = ''), 1400);
		} catch {}
	}
	// Human-readable run timestamp; the raw ISO value stays available as a tooltip.
	function fmtDate(iso: string) {
		const t = new Date(iso);
		if (Number.isNaN(t.getTime())) return iso;
		return t.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }) + ' UTC';
	}
	// Resource policy as "8 cores · 30.5 GiB" instead of raw JSON.
	function fmtPolicy(policy: unknown) {
		if (!policy || typeof policy !== 'object') return 'not recorded';
		const parts = Object.entries(policy as Record<string, unknown>).map(([k, v]) => k === 'cores' ? `${v} cores` : k === 'memory' ? `${v} memory` : `${k} ${typeof v === 'object' ? JSON.stringify(v) : v}`);
		return parts.join(' · ') || 'not recorded';
	}

	// Two-sided 95% Student-t critical values by degrees of freedom (1–30); normal beyond.
	const T95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];
	function meanInterval(values: number[]): [number, number] | null {
		const dist = sampleDistribution(values);
		if (!dist || dist.stdDev == null) return null;
		const half = (T95[dist.count - 2] ?? 1.96) * (dist.stdDev / Math.sqrt(dist.count));
		return [dist.mean - half, dist.mean + half];
	}
	const ordinal = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
	type Confidence = { level: 'High' | 'Medium' | 'Low'; color: string; why: string };
	// Confidence from the relative width of the 95% interval, demoted for few samples or repeated outliers.
	function confidence(interval: [number, number] | null, center: number, count: number, outliers: number): Confidence {
		if (!interval || count < 3) return { level: 'Low', color: 'var(--st-warn)', why: `Only ${count} sample${count === 1 ? '' : 's'}; no reliable interval.` };
		const rel = (interval[1] - interval[0]) / 2 / center;
		let rank = rel < 0.01 ? 2 : rel < 0.05 ? 1 : 0;
		const reasons = [`95% interval ±${fmtSpread(rel).replace('±', '')}`, `n = ${count}`];
		if (count < 5) { rank = Math.min(rank, 1); reasons.push('few samples'); }
		if (outliers >= 2) { rank = Math.max(0, rank - 1); reasons.push(`${outliers} outliers`); }
		else if (outliers) reasons.push('1 outlier');
		const level = (['Low', 'Medium', 'High'] as const)[rank];
		return { level, color: ['var(--st-warn)', 'var(--fg2)', 'var(--st-pass)'][rank], why: reasons.join(' · ') };
	}

	// ── Result cell ────────────────────────────────────────────────────────
	const cell = $derived.by(() => {
		if (d?.type !== 'cell') return null;
		const s = ui.scope;
		const b = ALLB.find((x) => x.id === d.b)!;
		const c = CB[d.c];
		const u = MET[d.m].u;
		const r = benchVal(s, b, c.id, d.m, d.cf);
		const t = ST[r.st];
		const measured = viewCell(s.machine,ui.snap,b.id,c.id,d.m);
		const reference=viewData.reports[measured.report];const rawReport=detail?.report.data;
  const report=reference?{...reference,runId:String(rawReport?.runId||reference.runId),created:String(rawReport?.created||reference.created),sha256:String(rawReport?.sourceReportSha256||reference.sha256)}:undefined;
  const method=(detail?.result.data as ResultData|undefined)?.measurementMethod;
		const options = (method?.recipe?.options||report?.options) as {launches?:number;samples?:number;scenario_samples?:Record<string,number>;warmup?:number} | undefined;
		const scenario = ({compile:'compile',rssCompile:'compile',inst:'instantiate',rssInst:'instantiate',first:'first-call',steady:'steady',rss:'steady',code:'compile'} satisfies Partial<Record<MetricKey,string>>)[d.m];
		const singleSamplePass = ['rss','rssCompile','rssInst','code'].includes(d.m);
		const phaseSamples = scenario ? options?.scenario_samples?.[scenario] : undefined;
		const sampleCount = singleSamplePass ? 1 : phaseSamples ?? options?.scenario_samples?.['*'] ?? options?.samples ?? 'unavailable';
		const rawConfig=detail?.configuration.data;const description=rawConfig?.description as Record<string,unknown>|undefined;
  const config = rawConfig?{runtime:String(rawConfig.id),version:String(rawConfig.version||description?.runtime_version||'not recorded'),backend:String(rawConfig.backend||description?.backend||'not recorded')}:viewData.hosts[s.machine].configurations[c.id];
		const ok = r.st === 'ok';
		const v = ok ? r.v : 0;
		const dots = ok && !['rss','rssCompile','rssInst','code'].includes(d.m) ? measured.samples || measured.launchMedians || [] : [];
		const distribution=sampleDistribution(dots);
		const fence = distribution ? 1.5 * (distribution.q3 - distribution.q1) : 0;
		const outliers = distribution ? dots.filter((x) => x < distribution.q1 - fence || x > distribution.q3 + fence).length : 0;
		const interval: [number, number] | null = ok && measured.interval ? [measured.interval[0], measured.interval[1]] : meanInterval(dots);
		const conf = ok && distribution ? confidence(interval, distribution.mean, distribution.count, outliers) : null;
		// Rank among the configurations visible in the table; overlapping 95% intervals count as a tie.
		const peers = CFG.filter((x) => isVisible(s, x) && !compileExcluded(s, x, d.m)).flatMap((x) => {
			const res = benchVal(s, b, x.id, d.m, d.cf);
			if (res.st !== 'ok') return [];
			const pc = viewCell(s.machine, ui.snap, b.id, x.id, d.m);
			return [{ c: x, v: res.v, ci: x.id === c.id ? interval : meanInterval(pc.samples || pc.launchMedians || []) }];
		}).sort((p, q) => p.v - q.v);
		const at = peers.findIndex((p) => p.c.id === c.id);
		const self = peers[at];
		const ties = self?.ci ? peers.filter((p) => p !== self && p.ci && p.ci[0] <= self.ci![1] && self.ci![0] <= p.ci[1]) : [];
		const best = ['rss', 'rssCompile', 'rssInst', 'code'].includes(d.m) ? 'smallest' : 'fastest';
		const name = (p: (typeof peers)[number]) => `${p.c.rt} ${p.c.be}`;
		const rank = ok && at >= 0 && peers.length > 1 ? {
			place: at === 0 ? `${best[0].toUpperCase() + best.slice(1)}` : `${ordinal(at + 1)} of ${peers.length}`,
			of: at === 0 ? `of ${peers.length} configurations` : '',
			detail: at === 0 ? `${relative(peers[1].v / v, ui.deltaFormat).replace(/^\+/, '')} ahead of ${name(peers[1])}` : `${relative(v / peers[0].v, ui.deltaFormat)} vs ${best} · ${name(peers[0])}`,
			ties: ties.length ? `Statistically tied with ${ties.slice(0, 2).map(name).join(', ')}${ties.length > 2 ? ` and ${ties.length - 2} more` : ''} (95% intervals overlap)` : ''
		} : null;
		// Scale is symmetric around the median so it always sits at the centre of the plot.
		const extent = distribution ? Math.max(v - Math.min(distribution.min, distribution.mean - (distribution.stdDev || 0)), Math.max(distribution.max, distribution.mean + (distribution.stdDev || 0)) - v) : 0;
		const lo = v - extent;
		const hi = v + extent;
		const X = (x: number) => 16 + ((x - lo) / (hi - lo || 1)) * 388;
		const sorted = [...dots].sort((a, b2) => a - b2);
		const artifactSha = String(detail?.workload.data.sha256 || b.artifactSha256);
        const cmd = report ? `just gather --rebuild /path/to/sealed/${report.runId}/report` : 'No sealed measurement for this cell';
		return {
			kicker: `${b.group} · ${MET[d.m].l}`,
			title: workloadName(b.id) + (d.caseLabel ? ' · ' + d.caseLabel : ''),
			b,
			c,
			ok,
			metric: MET[d.m].short,isLatency:!['rss','rssCompile','rssInst','rssFirst','code'].includes(d.m),
			st: t,
			stDesc: viewReason(measured) || ST_DESC[r.st] || '',
			abs: ok ? fmtU(v, u) : '',
			absCi: ok && interval ? `95% CI ${fmtU(interval[0], u)} – ${fmtU(interval[1], u)}` : '',
			conf,
			outliers,
			rank,
			dots: dots.map((x, i) => ({ x: X(x).toFixed(1), y: (24 + (((i * 3) % 5) - 2) * 3.5).toFixed(1), value: fmtU(x, u) })),
			medX: ok ? X(v).toFixed(1) : '0',
			boxX: distribution?X(distribution.q1).toFixed(1):'0',
			// Tails run to the extreme samples; a short stub keeps both visible when a quartile equals min or max.
			whiskerLo: distribution ? Math.min(X(distribution.min), X(distribution.q1) - 6).toFixed(1) : '0',
			whiskerHi: distribution ? Math.max(X(distribution.max), X(distribution.q1) + Math.max(2, X(distribution.q3) - X(distribution.q1)) + 6).toFixed(1) : '0',
            sdX:distribution?X(Math.max(0,distribution.mean-(distribution.stdDev||0))).toFixed(1):'0',sdW:distribution?Math.max(1,X(distribution.mean+(distribution.stdDev||0))-X(Math.max(0,distribution.mean-(distribution.stdDev||0)))).toFixed(1):'0',
			boxW: distribution?Math.max(2,X(distribution.q3)-X(distribution.q1)).toFixed(1):'0',
			// Edges are equidistant from the median, so label them as offsets rather than absolute values.
			minL: ok && extent ? '−' + fmtU(extent, u) : '',
			maxL: ok && extent ? '+' + fmtU(extent, u) : '',
			heroLabel: d.m === 'code' ? 'Measured size' : 'Median',
			count: distribution?.count ?? null,
			spread: distribution?.stdDev != null && distribution.mean > 0 ? fmtSpread(distribution.stdDev / distribution.mean) : '',
			stats: ok && distribution ? [
				{ k: 'Mean', v: fmtU(distribution.mean, u) },
				{ k: 'Std dev', v: distribution.stdDev !== null ? fmtU(distribution.stdDev, u) : 'n/a', tip: 'Sample standard deviation' },
				{ k: 'Min', v: fmtU(distribution.min, u) },
				{ k: 'Max', v: fmtU(distribution.max, u) }
			] : [],
			phaseNote: PHASE_NOTE[d.m],
			record: [
				{ title: 'Configuration', rows: [
					{ k: 'Runtime', v: config ? `${config.runtime} ${shortVersion(config.version)}` : 'not collected', href: configIdentity(s.machine, c.id).url, ext: true, tip: 'Open this runtime version’s source' },
					{ k: 'Backend', v: config?.backend || 'not collected', action: () => ui.openProfile(c.rt), tip: `Open the ${c.rt} profile` }
				] },
				{ title: 'Environment', rows: [
					{ k: 'Machine', v: detail ? [detail.environment.data.cpu_description, detail.environment.data.hostname].filter(Boolean).join(' · ') : MACH[s.machine].l, href: href('/benchmarks', { m: s.machine, metric: d.m }), tip: 'All benchmarks on this machine' },
					{ k: 'Resources', v: fmtPolicy(detail?.environment.data.policy || viewData.hosts[s.machine].policy) }
				] },
				{ title: 'Provenance', rows: [
					{ k: 'Recorded', v: report ? fmtDate(report.created) : 'not collected', tip: report?.created },
					{ k: 'Run ID', v: report ? report.runId : 'not collected', fine: true, copy: report?.runId },
					{ k: 'Artifact', v: `${workloadName(b.id)}.wasm · sha256 ${shortVersion(artifactSha)}`, href: corpusHref(b.id, `artifacts/${b.id.split('/').slice(1).join('/')}.wasm`), ext: true, copy: artifactSha, tip: `sha256 ${artifactSha}` },
					{ k: 'Source', v: b.src || 'unavailable', href: b.src ? corpusHref(b.id, b.src) : null, ext: true }
				] }
			] as RecordGroup[],
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
		const k = d.kid != null ? kidCells(f, ci, ui.scope)[d.kid] : compatCell(f.id, d.cid, ui.scope);
		const avail = k.run?'Recorded adapter configuration · representative contracts':'No recorded result';
    const contracts=featureContracts(f.id).filter(w=>d.kid==null || w.id===f.kids[d.kid][0]);
    const fails=contracts.map(w=>({w,cell:featureOutcome(ui.scope,w,d.cid)})).filter(x=>x.cell.st!=='ok').map(({w,cell})=>({
      st:cell.st,stColor:cell.st==='failed'?'var(--st-fail)':'var(--fg3)',file:w.src || w.id,
      kind:w.evidenceScope || 'unrecorded scope',expr:w.id,exp:'independent corpus oracle',act:cell.st,
      diag:viewReason(cell) || 'No recorded diagnostic',issue:cell.report?`Evidence: ${cell.report}`:'No report collected'
    }));
		const run = (v: number) => (k.run ? n0(v) : '—');
		return {
			kicker: `${sec.sec} · representative contracts`,
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
				{ k: 'Timed out', v: 'see raw outcomes', c: 'var(--fg2)' },
				{ k: 'Not run', v: n0(contracts.filter(w=>!featureOutcome(ui.scope,w,d.cid).report).length), c: 'var(--fg2)' }
			],
			meta: [
				{ k: 'Counting unit', v: `${sec.unit} (${n0(k.total)} total)` },
				{ k: 'Suite', v: sec.suite },
				{ k: 'Configuration', v: `${c.rt} ${configVersion(ui.machine,c.id)} · ${c.be}` },
				{ k: 'Tested', v: [...new Set(contracts.map(w=>featureOutcome(ui.scope,w,d.cid).report).filter(Boolean))].map(id=>viewData.reports[id].created).join(' · ') || 'not collected' },
				{ k: 'Scope', v: 'Execution verifies outputs; compile-only probes verify structural acceptance. Skipped includes unsupported or uncollected contracts.' }
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
				const list = CFG.map((c) => ({ c, x: ratio(s, g, c.id, g === 'code' ? i + 3 : i) }))
					.filter((e) => e.x != null)
					.map((e) => ({ c: e.c, r: e.x!.r, ci: e.x!.ci }))
					.sort((a, b) => a.r - b.r);
				if (!list.length) return;
				const f = list[0];
				const l = list[list.length - 1];
				if (f.c.rt === d.rt && list[1] && f.r + f.ci < list[1].r - list[1].ci)
					strengths.push({ t: `Lowest ${col.toLowerCase()} in this snapshot — ${f.c.be}`, v: relative(f.r,ui.deltaFormat) });
				if (l.c.rt === d.rt) tradeoffs.push({ t: `Highest ${col.toLowerCase()} in this snapshot — ${l.c.be}`, v: relative(l.r,ui.deltaFormat) });
			})
		);
		if (!strengths.length) strengths.push({ t: 'No metric where this runtime is the clear lowest in this scope.', v: '' });
		if (!tradeoffs.length) tradeoffs.push({ t: 'Not the highest on any aggregate in this scope.', v: '' });
		const fams = COMPAT[1].fams;
		const coverage = [
			...cfgs.map((c) => ({ k: `${c.be} — correct workloads`, v: `${n0(cov(c.id,ui.scope)[0])} / ${totalWorkloads()}` })),
			...cfgs.map((c) => ({
				k: `${c.be} — feature families with all corpus contracts passed`,
				v: `${fams.filter(f=>{const x=compatCell(f.id,c.id,ui.scope);return x.run && x.total>0 && x.pass===x.total;}).length} / ${fams.length}`
			}))
		];
		return { title: d.rt, cfgs, strengths, tradeoffs, coverage };
	});

	const kicker = $derived(cell?.kicker ?? compat?.kicker ?? 'Runtime profile');
	const title = $derived(cell?.title ?? compat?.title ?? profile?.title ?? '');

	// Close on a click outside the panel, unless that click opened something else in it
	// (e.g. another result cell), which replaces the panel's contents instead.
	let drawerAtPress: typeof ui.drawer = null;
	function onpointerdown() {
		drawerAtPress = ui.drawer;
	}
	function onclick(e: MouseEvent) {
		if (!ui.drawer || ui.drawer !== drawerAtPress) return;
		if (e.target instanceof Node && (panel?.contains(e.target) || !e.target.isConnected)) return;
		close();
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && ui.drawer) close();
	}

	// Move focus into the panel when it opens, return it to the opener when it closes,
	// and keep the page underneath from scrolling while the panel covers it.
	let panel = $state<HTMLDivElement>();
	let opener: HTMLElement | null = null;
	const isOpen = $derived(!!d);
	$effect(() => {
		if (!isOpen) return;
		opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		panel?.focus({ preventScroll: true });
		const root = document.documentElement;
		const prev = root.style.overflow;
		if (matchMedia('(max-width: 720px)').matches) root.style.overflow = 'hidden';
		return () => {
			root.style.overflow = prev;
			if (opener?.isConnected) opener.focus({ preventScroll: true });
		};
	});
</script>

<svelte:window {onkeydown} {onpointerdown} {onclick} />

{#if d}
	<div class="scrim" role="presentation" onclick={close} transition:fade={{ duration: 140 }}></div>
	<div class="drawer" role="dialog" aria-modal="true" aria-label={title} tabindex="-1" bind:this={panel} transition:fly={{ x: 40, duration: 180, opacity: 0 }}>
		<div class="top">
			<div class="titles">
				<div class="kicker">{kicker}</div>
				<div class="mono title">{title}</div>
			</div>
			<button class="esc" onclick={close} aria-label="Close" data-tip="Close · Esc">
				<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"
					><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" /></svg
				>
			</button>
		</div>
		<div class="body">
			{#if cell}
				<div class="ident">
					<Swatch color={cell.c.col} bg={cell.c.hollow ? 'transparent' : cell.c.col} size={9} />
					<span class="w5">{cell.c.rt}</span>
					<VersionLink id={cell.c.id} />
					<span class="chip mono">{cell.c.be}</span>
					<span class="pill" style:color={cell.st[2]} data-tip={cell.ok ? 'Output matched the independent oracle' : cell.stDesc}>
						<span aria-hidden="true">{cell.st[0]}</span>{cell.st[1]}
					</span>
				</div>
				{#if cell.ok}
					<div class="hero">
						<div class="small fg3">{cell.heroLabel}</div>
						<div class="hero-main">
							<div class="mono big">{cell.abs}</div>
							{#if cell.conf}<span class="conf" style:color={cell.conf.color} data-tip={cell.conf.why}><i></i>{cell.conf.level} confidence</span>{/if}
						</div>
						<div class="hero-sub mono small">
							{#if cell.absCi}<span data-tip="95% confidence interval of the mean (Student t)">{cell.absCi}</span>{/if}
							{#if cell.count != null}<span>n = {cell.count}</span>{/if}
							{#if cell.spread}<span data-tip="Coefficient of variation (std dev ÷ mean)">{cell.spread} spread</span>{/if}
							{#if cell.outliers}<span data-tip="Samples beyond 1.5× the interquartile range">{cell.outliers} outlier{cell.outliers === 1 ? '' : 's'}</span>{/if}
						</div>
						{#if cell.rank}
							<div class="rank">
								<span class="rank-place">{cell.rank.place}</span>
								{#if cell.rank.of}<span class="fg3">{cell.rank.of}</span>{/if}
								<span class="fg2">· {cell.rank.detail}</span>
								{#if cell.rank.ties}<div class="small fg3">{cell.rank.ties}</div>{/if}
							</div>
						{/if}
						<p class="lede">{cell.phaseNote}</p>
					</div>
					{#if cell.isLatency}<section class="sect">
						<h3 class="kicker">Sample distribution</h3>
						{#if cell.dots.length}
							<svg viewBox="0 0 420 48" class="dist" role="img" aria-label="Box plot with min–max tails, measured samples and a band showing mean plus or minus one sample standard deviation">
								<rect x={cell.sdX} width={cell.sdW} y="2" height="44" style:fill={cell.c.col} opacity="0.12" />
								<line x1={cell.whiskerLo} x2={cell.whiskerHi} y1="24" y2="24" style="stroke:var(--fg3)" />
								<line x1={cell.whiskerLo} x2={cell.whiskerLo} y1="17" y2="31" style="stroke:var(--fg3)" />
								<line x1={cell.whiskerHi} x2={cell.whiskerHi} y1="17" y2="31" style="stroke:var(--fg3)" />
								<rect x={cell.boxX} width={cell.boxW} y="12" height="24" style="fill:var(--bg3);stroke:var(--fg3)" />
								<line x1={cell.medX} x2={cell.medX} y1="8" y2="40" style="stroke:var(--fg);stroke-width:2" />
								{#each cell.dots as dot, i (i)}
									<circle cx={dot.x} cy={dot.y} r="3.5" style:fill={cell.c.col} style="stroke:var(--bg2);stroke-width:1"><title>Sample {i+1}: {dot.value}</title></circle>
								{/each}
							</svg>
							<div class="minmax mono"><span>{cell.minL}</span><span class="axis-med">{cell.abs}</span><span>{cell.maxL}</span></div>
							<ul class="legend small fg3">
								<li><i class="lg-dot" style:background={cell.c.col}></i>sample</li>
								<li><i class="lg-box"></i>middle 50%</li>
								<li><i class="lg-tail"></i>min – max</li>
								<li><i class="lg-med"></i>median</li>
								<li><i class="lg-band" style:background={cell.c.col}></i>mean ± 1 SD</li>
							</ul>
						{:else}<p class="small fg3">Samples were not retained for this older measurement.</p>{/if}
						{#if cell.stats.length}
							<dl class="tiles stats">
								{#each cell.stats as s (s.k)}
									<div data-tip={s.tip}><dt class="small fg3">{s.k}</dt><dd class="mono">{s.v}</dd></div>
								{/each}
							</dl>
						{/if}
					</section>{/if}
				{:else}
					<div class="desc mono">{cell.stDesc}</div>
					<p class="lede">{cell.phaseNote}</p>
				{/if}
				<section class="sect record">
					<h3 class="kicker">Run record</h3>
					{#each cell.record as g (g.title)}
						<div class="group">
							<div class="group-title small fg3">{g.title}</div>
							<dl>
								{#each g.rows as r (r.k)}
									<div class="kv">
										<dt class="fg3">{r.k}</dt>
										<dd class="mono" class:fine={r.fine}>
											{#if r.href}<a class="rlink" href={r.href} target={r.ext ? '_blank' : undefined} rel={r.ext ? 'noopener noreferrer' : undefined} data-tip={r.tip}>{r.v}{#if r.ext}<span class="ext" aria-hidden="true">↗</span>{/if}</a>
											{:else if r.action}<button class="rlink" onclick={r.action} data-tip={r.tip}>{r.v}<span class="ext" aria-hidden="true">→</span></button>
											{:else}<span data-tip={r.tip}>{r.v}</span>{/if}
											{#if r.copy}<button class="copy" onclick={() => copyValue(r.k, r.copy!)} aria-label={`Copy ${r.k}`} data-tip={copiedKey === r.k ? 'Copied' : `Copy full ${r.k.toLowerCase()}`}>{copiedKey === r.k ? '✓' : '⧉'}</button>{/if}
										</dd>
									</div>
								{/each}
							</dl>
						</div>
					{/each}
				</section>
			{:else if compat}
				<div class="ident">
					<Swatch color={compat.c.col} bg={compat.c.hollow ? 'transparent' : compat.c.col} size={9} />
					<span class="w5">{compat.c.rt} <VersionLink id={compat.c.id} /></span>
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
							<span class="mono"><VersionLink id={c.id} /> · {c.be}</span><span class="fg3">{c.kind}</span>
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
		{#if cell}
			<div class="foot">
				<a class="primary" href={siteHref(benchHref(cell.b.id))}>Open benchmark page</a>
				<button class="outline" onclick={() => ui.openProfile(cell.c.rt)}>{cell.c.rt} profile</button>
			</div>
		{/if}
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 49;
		background: rgba(0, 0, 0, 0.32);
	}
	.drawer {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		width: 460px;
		max-width: 100vw;
		box-sizing: border-box;
		background: var(--bg2);
		border-left: 1px solid var(--line2);
		box-shadow: -12px 0 32px rgba(0, 0, 0, 0.28);
		overflow: auto;
		overscroll-behavior: contain;
		-webkit-overflow-scrolling: touch;
		z-index: 50;
		display: flex;
		flex-direction: column;
		padding-bottom: env(safe-area-inset-bottom);
		padding-right: env(safe-area-inset-right);
	}
	.drawer:focus {
		outline: none;
	}
	@media (max-width: 720px) {
		.drawer {
			width: 100vw;
			border-left: 0;
		}
		.top {
			padding-top: max(12px, env(safe-area-inset-top));
		}
		.body {
			padding-bottom: 32px;
		}
	}
	/* Desktop keeps the page usable beside the panel, so other cells can be opened directly. */
	@media (min-width: 721px) {
		.scrim {
			display: none;
		}
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
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		margin: -4px -6px 0 0;
		border: 1px solid var(--line2);
		color: var(--fg2);
	}
	.esc:hover {
		color: var(--fg);
		border-color: var(--fg3);
	}
	@media (max-width: 720px) {
		.esc {
			width: 40px;
			height: 40px;
		}
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
	.three {
		grid-template-columns: repeat(3, 1fr);
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
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		font-size: 10px;
		color: var(--fg3);
	}
	.chip {
		font-size: 11px;
		color: var(--fg2);
		border: 1px solid var(--line2);
		padding: 0 5px;
		line-height: 16px;
	}
	.pill {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		font-weight: 500;
		padding: 1px 8px;
		border: 1px solid color-mix(in oklab, currentColor 40%, transparent);
		background: color-mix(in oklab, currentColor 10%, transparent);
		white-space: nowrap;
	}
	.hero {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding-bottom: 14px;
		border-bottom: 1px solid var(--line);
	}
	.hero .big {
		font-size: 28px;
		line-height: 1.15;
	}
	.hero-main {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.conf {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		white-space: nowrap;
	}
	.conf i {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: currentColor;
	}
	.rank {
		margin-top: 8px;
		font-size: 12px;
		display: flex;
		flex-wrap: wrap;
		gap: 2px 6px;
		align-items: baseline;
	}
	.rank-place {
		font-weight: 500;
	}
	.rank .small {
		flex-basis: 100%;
	}
	.hero-sub {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		color: var(--fg2);
	}
	.hero .lede {
		margin: 6px 0 0;
	}
	h3.kicker {
		margin: 0 0 4px;
		font-weight: 400;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		margin: 2px 0 0;
		padding: 0;
		list-style: none;
		font-size: 11px;
	}
	.legend li {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.legend i {
		display: inline-block;
		flex: none;
	}
	.lg-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
	}
	.lg-box {
		width: 12px;
		height: 8px;
		background: var(--bg3);
		border: 1px solid var(--fg3);
	}
	.axis-med {
		color: var(--fg);
	}
	.minmax > :last-child {
		text-align: right;
	}
	.lg-tail {
		width: 14px;
		height: 8px;
		background: linear-gradient(var(--fg3), var(--fg3)) center / 100% 1px no-repeat;
		border-left: 1px solid var(--fg3);
		border-right: 1px solid var(--fg3);
	}
	.lg-med {
		width: 2px;
		height: 11px;
		background: var(--fg);
	}
	.lg-band {
		width: 12px;
		height: 10px;
		opacity: 0.25;
	}
	.stats {
		grid-template-columns: repeat(4, 1fr);
		margin: 8px 0 0;
	}
	.stats > div {
		padding: 6px 8px;
	}
	.stats dd {
		margin: 0;
		font-size: 13px;
	}
	.record {
		gap: 10px;
	}
	.group dl {
		margin: 2px 0 0;
	}
	.group-title {
		font-weight: 500;
	}
	.kv {
		grid-template-columns: 96px 1fr;
	}
	.kv dd {
		margin: 0;
		display: flex;
		align-items: baseline;
		gap: 6px;
		min-width: 0;
	}
	.rlink {
		color: inherit;
		text-align: left;
		text-decoration: underline;
		text-decoration-color: var(--line2);
		text-underline-offset: 3px;
		word-break: break-word;
	}
	.rlink:hover {
		text-decoration-color: currentColor;
	}
	.ext {
		margin-left: 4px;
		color: var(--fg3);
		font-size: 11px;
	}
	.copy {
		flex: none;
		margin-left: auto;
		color: var(--fg3);
		font-size: 12px;
		line-height: 1;
		padding: 2px 4px;
	}
	.copy:hover {
		color: var(--fg);
	}
	.fine {
		font-size: 11px;
		color: var(--fg2);
	}
	.foot {
		position: sticky;
		bottom: 0;
		margin-top: auto;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
		padding: 12px 16px;
		background: var(--bg2);
		border-top: 1px solid var(--line);
	}
	.foot > * {
		text-align: center;
		padding: 8px 10px;
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
	@media (max-width: 420px) {
		.stats {
			grid-template-columns: repeat(2, 1fr);
		}
	}
</style>
