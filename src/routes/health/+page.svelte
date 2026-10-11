<script lang="ts">
	/** Live status: is the API answering, did the data load, and how fresh are the measurements. */
	import { onMount } from 'svelte';
	import { apiView } from '$lib/api/controller.svelte';
	import { datasetView, viewData } from '$lib/api/view.svelte';
	import { MACH } from '$lib/data/runtimes';
	import type { CfgId, MachineId } from '$lib/data/types';
	import { shortCount } from '$lib/format';
	import { siteHref } from '$lib/links';
	import KitchenScene from '$lib/components/KitchenScene.svelte';

	// ── API probe: /healthz every 15 s, keeping the last 24 round trips ──
	type Ping = { ok: boolean; ms: number; at: number };
	let pings = $state<Ping[]>([]);
	let revision = $state('');
	let now = $state(Date.now());
	async function probe() {
		const t0 = performance.now();
		let ok = false;
		try {
			const r = await fetch('/healthz', { cache: 'no-store' });
			ok = r.ok && (await r.json()).ready === true;
		} catch {
			ok = false;
		}
		pings = [...pings, { ok, ms: performance.now() - t0, at: Date.now() }].slice(-24);
		try {
			const p = await fetch('/api/platforms', { cache: 'no-store' });
			if (p.ok) revision = (await p.json()).revision ?? '';
		} catch {
			/* the API tile already shows the failure */
		}
	}
	onMount(() => {
		void probe();
		const ping = setInterval(probe, 15000);
		const tick = setInterval(() => (now = Date.now()), 10000);
		return () => {
			clearInterval(ping);
			clearInterval(tick);
		};
	});
	const last = $derived(pings.at(-1));
	const apiOk = $derived(!!last?.ok);

	// Measurements include historical versions; the main table selects only latest versions.
	type Cell = { at: number; results: number; version: string };
	const fresh = $derived.by(() => {
		datasetView.generation;
		const out = {} as Record<MachineId, { cells: Partial<Record<CfgId, Cell>>; results: number; newest: number }>;
		for (const m of Object.keys(viewData.hosts) as MachineId[]) {
			const host = viewData.hosts[m];
			const cells: Partial<Record<CfgId, Cell>> = {};
			let results = 0;
			for (const [key, cell] of Object.entries(host.snapshots.s1)) {
				if (cell.st !== 'ok') continue;
				results++;
				const cid = key.split('|').at(-2) as CfgId;
				const at = Date.parse(viewData.reports[cell.report]?.created ?? '');
				const c = (cells[cid] ??= { at: 0, results: 0, version: host.configurations[cid]?.version ?? '' });
				c.results++;
				if (Number.isFinite(at) && at > c.at) c.at = at;
			}
			let newest = Math.max(0, Date.parse(host.importedAt||host.capturedAt||'')||0, ...Object.values(cells).map((c) => c!.at));
			for (const report of Object.values(viewData.reports)) {
				const at = Date.parse(report.created);
				if (report.host === m && Number.isFinite(at)) newest = Math.max(newest, at);
			}
			out[m] = { cells, results, newest };
		}
		return out;
	});
	const machines = $derived(Object.keys(fresh) as MachineId[]);
	const totalResults = $derived(machines.reduce((s, m) => s + (viewData.hosts[m].latestRows??fresh[m].results), 0));
	const newest = $derived(Math.max(0, ...machines.map((m) => fresh[m].newest)));
	const newestMachine = $derived(machines.find((m) => fresh[m].newest === newest));

	const DAY = 86_400_000;
	function ago(at: number) {
		if (!at) return '—';
		const s = Math.max(0, (now - at) / 1000);
		if (s < 90) return 'just now';
		if (s < 3600) return `${Math.round(s / 60)}m ago`;
		if (s < DAY / 1000) return `${Math.round(s / 3600)}h ago`;
		return `${Math.round(s / 86400)}d ago`;
	}
	// Fresh within two days, ageing within a week and a half, stale beyond.
	const tone = (at: number) => (!at ? 'none' : now - at < 2 * DAY ? 'good' : now - at < 10 * DAY ? 'mid' : 'bad');
	const stamp = (at: number) => (at ? new Date(at).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : 'not collected');


	// ── Overall ──
	const issues = $derived.by(() => {
		const list: string[] = [];
		if (last && !last.ok) list.push('API not responding');
		if (apiView.error) list.push('dataset failed to load');
		if (apiView.ready && newest && now - newest > 10 * DAY) list.push('no new measurements in over 10 days');
		return list;
	});
	const overall = $derived(!last && !apiView.ready ? 'checking' : issues.length ? 'degraded' : 'ok');
</script>

<svelte:head>
	<title>Health · wasm.fyi</title>
</svelte:head>

<section class="gym">
	<KitchenScene fire={overall === 'degraded'} />

	<div class="code mono" aria-hidden="true">{overall === 'degraded' ? 503 : 200}</div>
	<h1 role="status">{overall === 'ok' ? 'All systems normal' : overall === 'checking' ? 'Warming up…' : 'Something’s off'}</h1>
	<p class="fg3">
		{#if issues.length}
			<span class="bad">{issues.join(' · ')}</span>
		{:else}
			API <span class="mono fg2">{last ? `${Math.round(last.ms)} ms` : '…'}</span>
			· <span class="mono fg2">{apiView.ready ? shortCount(totalResults) : '…'}</span> measurements
			· latest measurement <span class="mono fg2" data-tip={stamp(newest)}>{apiView.ready ? ago(newest) : '…'}</span>
		{/if}
	</p>
	{#if apiView.ready}
		<ul class="machines">
			{#each machines as m (m)}
				<li data-tip={stamp(fresh[m].newest)}><span class="dot {tone(fresh[m].newest)}"></span>{MACH[m]?.l ?? m} <span class="mono fg3">{ago(fresh[m].newest)}</span></li>
			{/each}
		</ul>
	{/if}
	<p class="foot fg3">checked every 15 s{revision ? ` · data ${revision.slice(0, 8)}` : ''} · <a class="link-quiet mono" href="/healthz">/healthz</a> · <a class="link-quiet" href={siteHref('/benchmarks')}>Benchmarks</a></p>
</section>

<style>
	.gym {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		padding: 40px 16px 64px;
		gap: 10px;
	}
	.code {
		font-size: 64px;
		line-height: 1;
		font-weight: 600;
		letter-spacing: 0.04em;
		margin-top: 4px;
	}
	h1 {
		font-size: 18px;
		font-weight: 600;
	}
	p {
		max-width: 520px;
		font-size: 13px;
		line-height: 1.5;
	}
	.bad {
		color: var(--bad);
	}
	.machines {
		list-style: none;
		margin: 6px 0 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 6px;
	}
	.machines li {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 3px 9px;
		font-size: 12px;
		border: 1px solid var(--line2);
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--fg3);
	}
	.dot.good {
		background: var(--good);
	}
	.dot.mid {
		background: oklch(0.8 0.13 90);
	}
	.dot.bad {
		background: var(--bad);
	}
	.foot {
		font-size: 11px;
		margin-top: 8px;
	}
</style>
