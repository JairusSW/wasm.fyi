<script lang="ts">
	import { COMPAT } from '$lib/data/features';
	import { CFG } from '$lib/data/runtimes';
	import { KER, SIMD_CC, SIMD_ISA, SIMD_M } from '$lib/data/snapshot';
	import type { Cfg } from '$lib/data/types';
	import { H, fmtU, fx, geomean, n0 } from '$lib/format';
	import { cn, compatCell, isOff, isVisible, mf } from '$lib/model';
	import { ui } from '$lib/state.svelte';
	import BarRow from '../BarRow.svelte';
	import RtLabel from '../RtLabel.svelte';
	import Seg from '../Seg.svelte';

	const kt = (k: (typeof KER)[number], c: Cfg) => {
		const m = SIMD_M[c.id];
		const ns = 1 + (H(k.id + c.id + 's') - 0.5) * 0.16;
		const nv = 1 + (H(k.id + c.id + 'v') - 0.5) * 0.16;
		const f = mf(ui.machine, c.id);
		return { sc: k.s * m[0] * ns * f, si: m[1] == null ? null : k.v * m[1] * nv * f };
	};

	const geo = $derived(ui.kernel === 'geomean');
	const gA = geomean(KER.map((k) => k.v));
	const absFmt = (v: number) => fmtU(geo ? v * gA : v, 'µs');

	const rows = $derived(
		CFG.filter((c) => !isOff(ui.scope, c.id) && isVisible(ui.scope, c)).map((c) => {
			if (!geo) {
				const k = KER.find((x) => x.id === ui.kernel) ?? KER[0];
				const t = kt(k, c);
				return { c, sp: t.si ? t.sc / t.si : null, abs: t.si };
			}
			const r = KER.map((k) => kt(k, c));
			if (r[0].si == null) return { c, sp: null, abs: null };
			return {
				c,
				sp: geomean(r.map((x) => x.sc / x.si!)),
				abs: geomean(r.map((x, i) => x.si! / KER[i].v))
			};
		})
	);
	const ok = $derived(rows.filter((r) => r.sp));
	const maxSp = $derived(Math.max(...ok.map((r) => r.sp!)));
	const maxAbs = $derived(Math.max(...ok.map((r) => r.abs!)));
	const bySp = $derived([...ok].sort((a, b) => b.sp! - a.sp!)[0]);
	const byAbs = $derived([...ok].sort((a, b) => a.abs! - b.abs!)[0]);

	const sup = $derived(
		CFG.filter((c) => isVisible(ui.scope, c)).map((c) => {
			const cc = compatCell(2847, COMPAT[1].fams[0].r[CFG.indexOf(c)]);
			const q = SIMD_CC[c.id];
			return {
				c,
				avail: ({ d: '● default', f: '⚑ flag', u: '— unavailable' } as Record<string, string>)[cc.av] ?? '? unknown',
				conf: cc.run ? `${n0(cc.pass)}/${n0(cc.total)}` : 'not run',
				confColor: cc.run && cc.pass < cc.total ? 'var(--st-fail)' : 'var(--fg)',
				isa: SIMD_ISA[c.id],
				cc: q ? fx(q[0]) : '—',
				cs: q && q[1] != null ? fx(q[1]) : 'n/a'
			};
		})
	);
	const ktab = $derived(
		CFG.filter((c) => isVisible(ui.scope, c)).map((c) => ({
			c,
			cells: KER.map((k) => {
				const t = kt(k, c);
				return t.si == null
					? { a: '⊘ unsupported', b: 'scalar ' + fmtU(t.sc, 'µs') }
					: { a: fmtU(t.si, 'µs'), b: `scalar ${fmtU(t.sc, 'µs')} · ${(t.sc / t.si).toFixed(1)}×` };
			})
		}))
	);
	const hw = $derived(
		ui.machine === 'm1'
			? 'AMD Ryzen 9 7950X — SSE4.2 · AVX2 · FMA3 · AVX-512 F/BW/VL/VNNI (reported by cpuid at run start)'
			: 'Ampere Altra — NEON (ASIMD) · no SVE (reported by /proc/cpuinfo at run start)'
	);
	const RELAXED = [
		['f32x4.relaxed_madd', 'vfmadd231ps · 1.21×', 'vfmadd231ps · 1.19×', 'vfmadd231ps · 1.24×'],
		['i8x16.relaxed_swizzle', 'pshufb · 1.08×', 'vpshufb · 1.11×', 'pshufb · 1.07×'],
		['i32x4.relaxed_trunc_f32x4_s', 'cvttps2dq · 1.33×', null, 'cvttps2dq · 1.30×']
	];
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
					<th class="r">Spec tests (assertions)</th>
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
		<Seg options={[...KER.map((k) => [k.id, k.id] as [string, string]), ['geomean', 'Geomean (4)']]} value={ui.kernel} onselect={(v) => (ui.kernel = v)} mono label="Kernel" />
		<span class="small fg3"
			>{geo ? 'Geometric mean over 4 matched kernels, in µs per iteration.' : (KER.find((k) => k.id === ui.kernel)?.size ?? '') + ' · median of 10 processes × 30 iterations'}</span
		>
	</div>
	{#if bySp && byAbs}
		<div class="callout">
			Largest scalar→SIMD gain: {cn(bySp.c)} ({bySp.sp!.toFixed(1)}×). Fastest absolute SIMD time: {cn(byAbs.c)} ({absFmt(byAbs.abs!)}). A large gain
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
					text={r.sp ? r.sp.toFixed(2) + '×' : ''}
					status="⊘ unsupported"
					cols="130px 1fr 110px"
					valueClass="fg2"
				/>
			{/each}
		</div>
		<div class="card">
			<div><div class="card-title">Absolute SIMD execution time</div><div class="note">median per iteration, across runtimes · lower is better</div></div>
			{#each rows as r (r.c.id)}
				<BarRow
					c={r.c}
					ok={!!r.sp}
					w={r.abs ? ((r.abs / maxAbs) * 100).toFixed(1) + '%' : '0%'}
					text={r.abs ? absFmt(r.abs) : ''}
					status="⊘ unsupported"
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
				<tr><th>Operation</th><th>wasmtime cranelift ⚑</th><th>wasmer llvm ⚑</th><th>v8 tiered ●</th><th>Others</th></tr>
			</thead>
			<tbody>
				{#each RELAXED as [op, ...cells] (op)}
					<tr>
						<td class="mono">{op}</td>
						{#each cells as c, i (i)}
							{#if c}<td class="mono">{c}</td>{:else}<td style:color="var(--st-fail)">✕ 4 assertions fail</td>{/if}
						{/each}
						<td class="fg3">— unavailable</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<div class="note">Cells: recorded lowering (from disassembly, reported) · speedup vs the strict-SIMD equivalent in the same runtime.</div>
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
