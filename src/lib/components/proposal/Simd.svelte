<script lang="ts">
	import { ordered } from '$lib/order.svelte';
	import { COMPAT } from '$lib/data/features';
	import { CFG } from '$lib/data/runtimes';
	import { viewData } from '$lib/view-data';
  import { featureValue } from '$lib/feature-values';
	import type { Cfg } from '$lib/data/types';
	import { fmtU, relative, geomean, n0 } from '$lib/format';
	import { cn, compatCell, isOff, isVisible, mf } from '$lib/model';
	import { ui } from '$lib/state.svelte';
	import BarRow from '../BarRow.svelte';
	import RtLabel from '../RtLabel.svelte';
	import Seg from '../Seg.svelte';

  const KER=[1,64,4096].map(n=>({id:`arithmetic/${n}`,size:`${n} loop iterations · one observed lane`,scalar:`features/simd/arithmetic-scalar-baseline/${n}`,vector:`features/simd/i32x4-add-multiply/${n}`}));
  const kt=(k:typeof KER[number],c:Cfg)=>({sc:featureValue(ui.scope,k.scalar,c.id),si:featureValue(ui.scope,k.vector,c.id)});

	const geo = $derived(ui.kernel === 'geomean');
	const gA = 1;
	const absFmt = (v: number) => fmtU(v, 'ms');

	const rows = $derived(
		ordered(CFG.filter((c) => !isOff(ui.scope, c.id) && isVisible(ui.scope, c))).map((c) => {
			if (!geo) {
				const k = KER.find((x) => x.id === ui.kernel) ?? KER[0];
				const t = kt(k, c);
				return { c, sp: t.si && t.sc ? t.sc / t.si : null, abs: t.si };
			}
			const r = KER.map((k) => kt(k, c));
			if (r.some(x=>x.si==null || x.sc==null)) return { c, sp: null, abs: null };
			return {
				c,
				sp: geomean(r.map((x) => x.sc! / x.si!)),
				abs: geomean(r.map(x=>x.si!))
			};
		})
	);
	const ok = $derived(rows.filter((r) => r.sp));
	const maxSp = $derived(Math.max(...ok.map((r) => r.sp!)));
	const maxAbs = $derived(Math.max(...ok.map((r) => r.abs!)));
	const bySp = $derived([...ok].sort((a, b) => b.sp! - a.sp!)[0]);
	const byAbs = $derived([...ok].sort((a, b) => a.abs! - b.abs!)[0]);

	const sup = $derived(
		ordered(CFG.filter((c) => isVisible(ui.scope, c))).map((c) => {
			const cc = compatCell('simd',c.id,ui.scope);
			const k=KER.find(k=>k.id===ui.kernel) || KER[0];
      const sc=featureValue(ui.scope,k.scalar,c.id,'compile'),si=featureValue(ui.scope,k.vector,c.id,'compile');
      const code=featureValue(ui.scope,k.vector,c.id,'code');
			return {
				c,
				avail: ({ d: '● recorded', f: '⚑ flag', u: 'not displayed' } as Record<string, string>)[cc.av] ?? '? unknown',
				conf: cc.run ? `${n0(cc.pass)}/${n0(cc.total)}` : 'not run',
				confColor: cc.run && cc.pass < cc.total ? 'var(--st-fail)' : 'var(--fg)',
				isa: 'not collected',
				cc: sc && si ? relative(si/sc,ui.deltaFormat) : 'not measured',
				cs: code!=null ? fmtU(code,'KiB') : 'not collected'
			};
		})
	);
	const ktab = $derived(
		ordered(CFG.filter((c) => isVisible(ui.scope, c))).map((c) => ({
			c,
			cells: KER.map((k) => {
				const t = kt(k, c);
				return t.si == null
					? { a: 'not measured', b: t.sc==null?'scalar not measured':'scalar '+fmtU(t.sc,'ms') }
					: { a: fmtU(t.si, 'ms'), b: t.sc==null?'scalar not measured':`scalar ${fmtU(t.sc, 'ms')} · ${relative(t.sc / t.si,ui.deltaFormat)}` };
			})
		}))
	);
  const hw=$derived(viewData.hosts[ui.machine].label+' · emitted ISA not collected');
  const RELAXED=$derived(['exact-madd','in-range-swizzle','all-bits-laneselect'].map(variant=>{
    const id=`features/relaxed-simd/${variant}/4096`;
    return [variant,...(['A','C','F'] as const).map(c=>{const v=featureValue(ui.scope,id,c);return v==null?'not measured':fmtU(v,'ms');})];
  }));

</script>

<div class="host mono">Host: {hw}</div>

<div class="sect">
	<h3>Support, conformance and implementation</h3>
	<div class="tbl-wrap">
		<table class="t" style:min-width="820px">
			<thead>
				<tr>
					<th>Configuration</th>
					<th>Availability</th>
					<th class="r">Corpus contracts</th>
					<th>ISA used by codegen</th>
					<th class="r">Compile cost · SIMD corpus</th>
					<th class="r">Native code · SIMD corpus</th>
				</tr>
			</thead>
			<tbody>
				{#each sup as r (r.c.id)}
					<tr>
						<td class="nowrap"><RtLabel c={r.c} ver /></td>
						<td>{r.avail}</td>
						<td class="r">
							<button class="mono conf" style:color={r.confColor} onclick={() => (ui.drawer = { type: 'compat', fam: 'simd', cid: r.c.id })}
								>{r.conf}</button
							>
						</td>
						<td class="mono small fg2">{r.isa}</td>
						<td class="mono r">{r.cc}</td>
						<td class="mono r">{r.cs}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<div class="sect g8">
	<div class="row">
		<h3>Matched scalar vs SIMD kernels</h3>
		<Seg options={[...KER.map((k) => [k.id, k.id] as [string, string]), ['geomean', 'Geomean (3 sizes)']]} value={ui.kernel} onselect={(v) => (ui.kernel = v)} mono label="Kernel" />
		<span class="small fg3"
			>{geo ? 'Geometric mean over 3 input sizes, in ms per invocation.' : (KER.find((k) => k.id === ui.kernel)?.size ?? '') + ' · recorded independent launch medians'}</span
		>
	</div>
	{#if bySp && byAbs}
		<div class="callout">
			Largest scalar→SIMD gain: {cn(bySp.c)} ({relative(bySp.sp!,ui.deltaFormat)}). Fastest absolute SIMD time: {cn(byAbs.c)} ({absFmt(byAbs.abs!)}). A large gain
			from a slow scalar baseline is not the same as fast SIMD.
		</div>
	{/if}
	<div class="cards">
		<div class="card">
			<div><div class="card-title">Speedup within each configuration</div><div class="note">scalar time ÷ SIMD time, same runtime · higher = larger gain</div></div>
			{#each rows as r (r.c.id)}
				<BarRow
					c={r.c}
					ok={!!r.sp}
					w={r.sp ? ((r.sp / maxSp) * 100).toFixed(1) + '%' : '0%'}
					text={r.sp ? relative(r.sp,ui.deltaFormat) : ''}
					status="not measured"
					cols="130px 1fr 110px"
					valueClass="fg2"
				/>
			{/each}
		</div>
		<div class="card">
			<div><div class="card-title">Absolute SIMD execution time</div><div class="note">median per invocation, across runtimes · lower is better</div></div>
			{#each rows as r (r.c.id)}
				<BarRow
					c={r.c}
					ok={!!r.sp}
					w={r.abs ? ((r.abs / maxAbs) * 100).toFixed(1) + '%' : '0%'}
					text={r.abs ? absFmt(r.abs) : ''}
					status="not measured"
					cols="130px 1fr 110px"
				/>
			{/each}
		</div>
	</div>
	<div class="tbl-wrap">
		<table class="t" style:min-width="820px">
			<thead>
				<tr>
					<th>Configuration</th>
					{#each KER as k (k.id)}
						<th class="r"><div class="mono kh">{k.id}</div><div class="micro fg3 w4">{k.size}</div></th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each ktab as r (r.c.id)}
					<tr>
						<td class="nowrap"><RtLabel c={r.c} /></td>
						{#each r.cells as c, i (i)}
							<td class="r"><div class="mono">{c.a}</div><div class="mono micro fg3">{c.b}</div></td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<div class="sect relaxed">
	<div class="row">
		<h3>Relaxed SIMD — separate experiment</h3>
		<span class="s12 fg3">Results permitted to vary by hardware. Never merged into strict-SIMD aggregates.</span>
	</div>
	<div class="tbl-wrap">
		<table class="t" style:min-width="760px">
			<thead>
				<tr><th>Operation</th><th>wasmtime cranelift</th><th>wasmer llvm</th><th>v8 embedding</th><th>Others</th></tr>
			</thead>
			<tbody>
				{#each RELAXED as [op, ...cells] (op)}
					<tr>
						<td class="mono">{op}</td>
						{#each cells as c, i (i)}
							{#if c}<td class="mono">{c}</td>{:else}<td style:color="var(--st-fail)">✕ 4 assertions fail</td>{/if}
						{/each}
						<td class="fg3">not displayed</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<div class="note">Cells: Recorded execution latency for the 4,096-operation contract. Disassembly and matched strict-SIMD speedups are not collected.</div>
</div>

<style>
	.host {
		font-size: 11px;
		color: var(--fg2);
		border: 1px solid var(--line);
		padding: 6px 10px;
		background: var(--bg2);
	}
	.sect {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.g8 {
		gap: 8px;
	}
	h3 {
		font-size: 13px;
		font-weight: 600;
	}
	.conf {
		text-decoration: underline;
		text-decoration-color: var(--line2);
	}
	.callout {
		font-size: 12px;
		border: 1px solid var(--line2);
		padding: 8px 12px;
		background: var(--bg2);
	}
	.kh {
		color: var(--fg);
		font-size: 12px;
	}
	.w4 {
		font-weight: 400;
	}
	.s12 {
		font-size: 12px;
	}
	.relaxed {
		border-top: 1px solid var(--line);
		padding-top: 14px;
	}
</style>
