<script lang="ts">
	import Swatch from '$lib/components/Swatch.svelte';
	import { CFG, configVersion } from '$lib/data/runtimes';
	import { siteHref } from '$lib/links';
	import { disp, isVisible, ratio, sharedCount } from '$lib/model';
	import { ui } from '$lib/state.svelte';
	import { viewData } from '$lib/view-data';
	import type { BlockProps } from '../../types';

	type C = { eyebrow: string; title: string; lead: string; board: boolean; rows: number };
	let { config }: BlockProps<C> = $props();

	const board = $derived.by(() => {
		const s = ui.scope;
		const lb = CFG.filter((c) => isVisible(s, c))
			.map((c) => ({ c, r: ratio(s, 'lat', c.id, 3) }))
			.filter((x) => x.r)
			.sort((a, b) => a.r!.r - b.r!.r)
			.slice(0, Math.max(1, config.rows || 5));
		const r0 = lb[0]?.r!.r ?? 1;
		const rMax = lb.length ? lb[lb.length - 1].r!.r : 1;
		return lb.map((x, i) => ({
			c: x.c,
			rank: i + 1,
			report: x.r!.report,
			w: Math.max(4, (Math.log(x.r!.r / r0 + 1) / Math.log(rMax / r0 + 1)) * 100).toFixed(1) + '%',
			val: disp(s, 'lat', x.c.id, 3)!.t
		}));
	});
	const nShared = $derived(`${sharedCount(ui.scope)} shared measured contracts`);
</script>

<section class="hero" class:solo={!config.board}>
	<div class="intro">
		{#if config.eyebrow}<span class="mono fg3 s12">{config.eyebrow}</span>{/if}
		<h1>{config.title}</h1>
		{#if config.lead}<p class="lead">{config.lead}</p>{/if}
		<div class="ctas">
			<a class="btn-primary" href={siteHref(`/benchmarks`)}>Explore benchmarks</a>
			<a class="btn-outline" href={siteHref(`/features`)}>Feature status</a>
		</div>
	</div>
	{#if config.board}
		<div class="panel board">
			<div class="board-head">
				<span class="w6">Fastest execution</span>
				<span class="mono small fg3">{board[0] ? viewData.reports[board[0].report].created.slice(0, 10) : 'not measured'} · per invocation</span>
			</div>
			<div class="board-rows">
				{#each board as b (b.c.id)}
					<button
						class="board-row"
						onclick={() => ui.openProfile(b.c.rt)}
						data-tip={`${b.c.rt} ${configVersion(ui.machine, b.c.id)} · ${b.c.be}\n${b.c.kind}\nClick to open runtime profile`}
					>
						<span class="mono small fg3">{b.rank}</span>
						<span class="rtname">
							<Swatch color={b.c.col} bg={b.c.hollow ? 'transparent' : b.c.col} />{b.c.rt}
							<span class="small fg3">{b.c.be}</span>
						</span>
						<span class="bar" style:width={b.w} style:background={b.c.col}></span>
						<span class="mono r s12">{b.val}</span>
					</button>
				{/each}
			</div>
			<div class="board-foot small fg3">Geometric mean over {nShared} in one pinned report · independent launch bootstrap</div>
		</div>
	{/if}
</section>

<style>
	.s12 {
		font-size: 12px;
	}
	.w6 {
		font-weight: 600;
	}
	.hero {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(340px, 100%), 1fr));
		gap: 40px;
		align-items: center;
		padding: 48px 0 40px;
	}
	.hero.solo {
		grid-template-columns: 1fr;
	}
	.intro {
		display: flex;
		flex-direction: column;
		gap: 18px;
		max-width: 600px;
	}
	h1 {
		font-size: 46px;
		line-height: 1.05;
		font-weight: 600;
		letter-spacing: -0.025em;
		text-wrap: balance;
	}
	.lead {
		font-size: 16px;
		line-height: 1.55;
		color: var(--fg2);
		text-wrap: pretty;
	}
	.ctas {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}
	.board {
		display: flex;
		flex-direction: column;
	}
	.board-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 8px;
		padding: 12px 16px;
		border-bottom: 1px solid var(--line);
	}
	.board-rows {
		padding: 10px 16px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.board-row {
		display: grid;
		grid-template-columns: 16px 150px 1fr 70px;
		gap: 10px;
		align-items: center;
		font-size: 13px;
	}
	.rtname {
		display: flex;
		align-items: center;
		gap: 7px;
		white-space: nowrap;
	}
	.bar {
		height: 8px;
		opacity: 0.85;
	}
	.board-foot {
		padding: 10px 16px;
		border-top: 1px solid var(--line);
	}
</style>
