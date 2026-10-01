<script lang="ts">
	import { siteHref } from '$lib/links';
	import Gc from '$lib/components/proposal/Gc.svelte';
	import Memory64 from '$lib/components/proposal/Memory64.svelte';
	import Simd from '$lib/components/proposal/Simd.svelte';
	import Threads from '$lib/components/proposal/Threads.svelte';
	import { BROWSERS, FEATS, PROPS } from '$lib/data/features';
	import { RTS } from '$lib/data/runtimes';
	import type { SupportCode } from '$lib/data/types';
	import { PROPOSAL_IDS } from '$lib/links';
	import { ui } from '$lib/state.svelte';
	import { browserCell, supportCell, supportOf } from '$lib/support';

	let { data } = $props();

	const P = $derived(PROPS[data.id]);
	const PF = $derived(FEATS.find((f) => f.id === data.id)!);
	const status = $derived([
		{ k: 'Phase', v: PF.phase },
		{ k: 'Standard', v: P.ver },
		{ k: 'Spec repository', v: P.repo },
		{ k: 'Evidence scope', v: 'Representative adapter corpus · browser builds uncollected' }
	]);
	const browsers = $derived(BROWSERS.map((b, i) => ({ name: b, ...browserCell(PF.b[i]) })));
	const tools = $derived(P.tools.map(([name, c, flag]) => ({ name, flag, ...supportCell(c) })));
	const groups = $derived(
		(
			[
				['y', 'Corpus passed'],
				['f', 'Behind a flag'],
				['p', 'Partial'],
				['n', 'Not supported'],
				['?', 'Unknown']
			] as [SupportCode, string][]
		)
			.map(([code, label]) => ({ label, glyph: supportCell(code).glyph, items: RTS.filter((r) => supportOf(r.id, PF, ui.scope) === code) }))
			.filter((x) => x.items.length)
	);
</script>

<svelte:head>
	<title>{P.title} · wasm.fyi</title>
	<meta name="description" content="{P.long}: {P.q}" />
</svelte:head>

<div class="stack6">
	<span class="mono small fg3">wasm.fyi/{data.id}</span>
	<div class="title-line">
		<h1>{P.title}</h1>
		<span class="fg2 s13">{P.long}</span>
	</div>
	<div class="others">
		{#each PROPOSAL_IDS as id (id)}
			<a class="other" class:on={id === data.id} href={siteHref(`/${id}`)} aria-current={id === data.id ? 'page' : undefined}>{PROPS[id].title}</a>
		{/each}
	</div>
</div>

<div class="tiles adoption">
	<div class="col">
		<span class="kicker">Status</span>
		{#each status as k (k.k)}
			<div class="kv"><span class="small fg3">{k.k}</span><span class="mono s12">{k.v}</span></div>
		{/each}
		<div class="hist">
			<span class="small fg3">Standardization history</span>
			{#each P.hist as [y, t] (y + t)}
				<div class="hrow"><span class="mono fg3">{y}</span><span>{t}</span></div>
			{/each}
		</div>
	</div>
	<div class="col">
		<span class="kicker">Browsers</span>
		{#each browsers as b (b.name)}
			<div class="srow"><span>{b.name}</span><span class="mono pill" style:background={b.bg} style:color={b.color}>{b.glyph} {b.text}</span></div>
		{/each}
		<span class="kicker mt">Toolchains</span>
		{#each tools as t (t.name)}
			<div class="trow">
				<span>{t.name} <span class="mono micro fg3">{t.flag}</span></span>
				<span class="mono pill0" style:background={t.bg} style:color={t.color}>{t.glyph} {t.text}</span>
			</div>
		{/each}
	</div>
	<div class="col">
		<span class="kicker">Runtimes</span>
		{#each groups as g (g.label)}
			<div class="grp">
				<span class="small fg3">{g.glyph} {g.label}</span>
				<div class="rts">
					{#each g.items as r (r.id)}
						{#if r.cfg}
							<button class="rt" onclick={() => ui.openProfile(r.id)} data-tip="Open {r.name} runtime profile">{r.name}</button>
						{:else}
							<span class="rt" data-tip="{r.name} is tracked but not collected in the recorded adapter configurations">{r.name}</span>
						{/if}
					{/each}
				</div>
			</div>
		{/each}
		<a class="link-quiet" href={siteHref(`/features?view=tests`)}>Spec test results</a>
	</div>
</div>

<div class="perf-head">
	<span class="kicker">Performance</span>
	<h2>{P.q}</h2>
</div>

{#if data.id === 'simd'}
	<Simd />
{:else if data.id === 'gc'}
	<Gc />
{:else if data.id === 'memory64'}
	<Memory64 />
{:else}
	<Threads />
{/if}

<style>
	.stack6 {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.title-line {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 14px;
		align-items: baseline;
	}
	h1 {
		font-size: 20px;
		font-weight: 600;
	}
	.s13 {
		font-size: 13px;
	}
	.s12 {
		font-size: 12px;
	}
	.others {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.other {
		border: 1px solid var(--line2);
		padding: 1px 8px;
		font-size: 12px;
		color: var(--fg2);
		text-decoration: none;
	}
	.other.on {
		border-color: var(--fg2);
		background: var(--bg3);
	}
	.adoption {
		grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr));
	}
	.col {
		padding: 12px 14px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.kv {
		display: flex;
		flex-direction: column;
	}
	.hist {
		display: flex;
		flex-direction: column;
		gap: 3px;
		border-top: 1px solid var(--line);
		padding-top: 8px;
	}
	.hrow {
		display: grid;
		grid-template-columns: 42px 1fr;
		gap: 6px;
		font-size: 12px;
	}
	.srow {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 12px;
		border-bottom: 1px solid var(--line);
		padding: 3px 0;
	}
	.pill {
		padding: 1px 8px;
	}
	.pill0 {
		padding: 0 8px;
	}
	.mt {
		margin-top: 6px;
	}
	.trow {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 8px;
		font-size: 12px;
		border-bottom: 1px solid var(--line);
		padding: 3px 0;
	}
	.grp {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.rts {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.rt {
		border: 1px solid var(--line2);
		padding: 1px 8px;
		font-size: 12px;
	}
	.col > .link-quiet {
		align-self: flex-start;
	}
	.perf-head {
		display: flex;
		flex-direction: column;
		gap: 2px;
		border-top: 1px solid var(--line);
		padding-top: 14px;
	}
	h2 {
		font-size: 16px;
		font-weight: 600;
	}
</style>
