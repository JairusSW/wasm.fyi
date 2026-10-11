<script lang="ts">
	import { onMount } from 'svelte';
	import { BUCKET, ORIGINS, fmtBytes, fmtRate, type Analytics, type AllTime, type Bandwidth, type BwPoint, type BwWindow, type Client, type Origin, type Range, type Share } from '$lib/admin/data';
	import { shortCount } from '$lib/format';
	import { clientKey, placeKey } from '$lib/admin/identity';
	import Seg from '$lib/components/Seg.svelte';
	import Spark from '$lib/components/admin/Spark.svelte';
	import TrafficChart from '$lib/components/admin/TrafficChart.svelte';
	import UpDownChart from '$lib/components/admin/UpDownChart.svelte';
	import WorldMap from '$lib/components/admin/WorldMap.svelte';

	// Session authorization is enforced server-side, independently of rendering.
 const LIVE_SECONDS = 60;
 type Session = {state:'out'|'redirecting'|'in'|'denied';login?:string;avatarUrl?:string;development?:boolean};
 let session = $state<Session>({state:'redirecting'});
 let configured = $state(true);
 const login = $derived(session.login ?? '');
 async function signOut(){try{const response=await fetch('/auth/logout',{method:'POST',credentials:'same-origin'});if(response.ok)session={state:'out'};else error='Could not sign out. Please retry.';}catch{error='Could not sign out. Please retry.';}}
 let range = $state<Range>('7d');
 let bwWindow = $state<BwWindow>('1d');
 let now = $state(Date.now());
 let mounted = $state(false);
 let refresh = $state(0);
 let error = $state('');
 let analyticsLoading = $state(true);
 let bandwidthLoading = $state(true);
 let totalsLoading = $state(true);
 let data = $state<Analytics>({range:'7d',generated:0,kpis:[],series:[],clients:[],endpoints:[],pages:[],referrers:[],countries:[],devices:[],browsers:[],runtimes:[],workloads:[],log:[],places:[]});
 let total = $state<AllTime>({since:0,visitors:0,pageviews:0,apiRequests:0,apiByOrigin:{website:0,programmatic:0,bots:0},apiDown:0,apiUp:0,totalDown:0,totalUp:0,clients:0});
 let bw = $state<Bandwidth>({window:'1d',step:900000,series:[],down:0,up:0,prevDown:0,prevUp:0,peakDown:0});
 onMount(()=>{mounted=true;let alive=true;void fetch('/auth/me',{credentials:'same-origin',cache:'no-store'}).then(async response=>{const result=await response.json();if(!alive)return;if(response.ok)session={state:'in',...result};else{configured=result.configured!==false;session={state:response.status===403?'denied':'out'};}}).catch(()=>{if(alive){session={state:'out'};error='Unable to reach the sign-in service.';}});const clock=setInterval(()=>now=Date.now(),1000);const poll=setInterval(()=>refresh++,60000);return ()=>{alive=false;mounted=false;clearInterval(clock);clearInterval(poll)};});
 async function read<T>(path:string,signal:AbortSignal):Promise<T>{const response=await fetch(path,{signal,credentials:'same-origin',cache:'no-store'});if(response.status===401){session={state:'out'};throw new Error('Session expired. Please sign in again.')}if(!response.ok)throw new Error('Analytics temporarily unavailable.');return response.json();}
 $effect(()=>{if(!mounted||session.state!=='in')return;const selected=range;refresh;const abort=new AbortController();analyticsLoading=true;void read<Analytics>('/api/admin/analytics?range='+selected,abort.signal).then(value=>{data=value;analyticsLoading=false;error=''}).catch(e=>{if(!abort.signal.aborted){error=String(e);analyticsLoading=false}});return ()=>abort.abort();});
 $effect(()=>{if(!mounted||session.state!=='in')return;const selected=bwWindow;refresh;const abort=new AbortController();bandwidthLoading=true;void read<Bandwidth>('/api/admin/bandwidth?window='+selected,abort.signal).then(value=>{bw=value;bandwidthLoading=false}).catch(e=>{if(!abort.signal.aborted){error=String(e);bandwidthLoading=false}});return ()=>abort.abort();});
 $effect(()=>{if(!mounted||session.state!=='in')return;refresh;const abort=new AbortController();void read<AllTime>('/api/admin/totals',abort.signal).then(value=>{total=value;totalsLoading=false}).catch(e=>{if(!abort.signal.aborted){error=String(e);totalsLoading=false}});return ()=>abort.abort();});
 $effect(()=>{if(!mounted||session.state!=='in')return;const source=new EventSource('/api/admin/live');source.onmessage=event=>{try{const value=JSON.parse(event.data);live=[...live.filter(p=>value.rate.at-p.at<60000),value.rate].slice(-60);}catch{error='Invalid live analytics response.'}};return ()=>source.close();});
	const BW_WINDOWS: [BwWindow, string][] = [['1h', 'Hour'], ['1d', 'Day'], ['1w', 'Week'], ['1m', 'Month']];
	const BW_TEXT: Record<BwWindow, string> = { '1h': 'hour', '1d': 'day', '1w': 'week', '1m': '30 days' };
	const bwWhen = (at: number) => {
		const d = new Date(at);
		if (bwWindow === '1h' || bwWindow === '1d') return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
		if (bwWindow === '1w') return d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric' });
		return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	};
	const bwTicks = $derived.by(() => {
		const n = bw.series.length;
		const every = Math.ceil(n / 6);
		const text = (at: number) => {
			const d = new Date(at);
			if (bwWindow === '1h' || bwWindow === '1d') return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: bwWindow === '1h' ? '2-digit' : undefined });
			if (bwWindow === '1w') return d.toLocaleDateString(undefined, { weekday: 'short' });
			return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
		};
		return bw.series.map((p, i) => ({ i, text: text(p.at) })).filter(({ i }) => (n - 1 - i) % every === 0);
	});
	// ── Map: where visitors and API callers are, by city ──
	let mapMetric = $state<'visitors' | 'api'>('visitors');
	let mapMode = $state<'heat' | 'dots'>('heat');
	const MAP_METRICS: [typeof mapMetric, string][] = [['visitors', 'Unique views'], ['api', 'API callers']];
	const MAP_MODES: [typeof mapMode, string][] = [['heat', 'Heat'], ['dots', 'Dots']];
	const places = $derived(data.places);
	const spots = $derived(
		places
			.map((p) => ({ key: placeKey(p), label: p.city, sub: p.country, lat: p.lat, lon: p.lon, value: mapMetric === 'visitors' ? p.visitors : p.api }))
			.sort((a, b) => b.value - a.value)
	);
	const spotTotal = $derived(spots.reduce((s, p) => s + p.value, 0));
 let live = $state<BwPoint[]>([]);
	const liveNow = $derived(live[live.length - 1] ?? {at:now,down:0,up:0});
	const liveMinute = $derived({ down: live.reduce((s, p) => s + p.down, 0), up: live.reduce((s, p) => s + p.up, 0) });
	const secsAgo = (at: number) => `${Math.max(0, Math.round((Date.now() - at) / 1000))}s ago`;

	const ORIGIN_LABEL: Record<Origin, string> = { website: 'Website', programmatic: 'Programmatic', bots: 'Bots' };
	const ORIGIN_COLOR: Record<Origin, string> = { website: 'var(--rt-v8)', programmatic: 'var(--rt-wasmer)', bots: 'var(--rt-wazero)' };
	const ORIGIN_HOW: Record<Origin, string> = {
		website: 'Same-origin fetch from wasm.fyi pages: Sec-Fetch-Site: same-origin and our Origin.',
		programmatic: 'No browser fetch metadata: scripts, CI, notebooks, CLIs. Grouped by user agent and network, or API key when sent.',
		bots: 'Known crawler and AI UA families. Verified network labels require reverse and forward DNS confirmation.'
	};

	let chartMode = $state<'visitors' | 'pageviews' | 'api'>('visitors');
	let clientFilter = $state<'all' | Client['origin']>('all');
	const clients = $derived(data.clients.filter((c) => clientFilter === 'all' || c.origin === clientFilter).sort((a, b) => b.requests - a.requests));

	const originTotals = $derived(Object.fromEntries(ORIGINS.map((o) => [o, data.series.reduce((s, p) => s + p.api[o], 0)])) as Record<Origin, number>);
	const apiTotal = $derived(ORIGINS.reduce((s, o) => s + originTotals[o], 0));
	const pct = (v: number, of: number) => (of ? (v / of) * 100 : 0);

	// ── Formatting ──
	function fmtValue(v: number, unit?: string) {
		if (unit === 's') return `${Math.floor(v / 60)}m ${String(Math.round(v % 60)).padStart(2, '0')}s`;
		if (unit === '%') return `${v.toFixed(v < 1 ? 2 : 1)}%`;
		if (unit === 'ms') return `${Math.round(v)} ms`;
		return shortCount(v);
	}
	function delta(v: number, prev: number, invert = false) {
		if (!prev) return { text: '—', tone: '' };
		const d = ((v - prev) / prev) * 100;
		const good = invert ? d < 0 : d > 0;
		return { text: `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}%`, tone: Math.abs(d) < 0.5 ? '' : good ? 'good' : 'bad' };
	}
	function ago(at: number) {
		const s = Math.max(0, (now - at) / 1000);
		if (s < 60) return `${Math.round(s)}s ago`;
		if (s < 3600) return `${Math.round(s / 60)}m ago`;
		if (s < 86400) return `${Math.round(s / 3600)}h ago`;
		return `${Math.round(s / 86400)}d ago`;
	}
	const RANGES: [Range, string][] = [['24h', '24h'], ['7d', '7d'], ['30d', '30d']];
	const CHARTS: [typeof chartMode, string][] = [['visitors', 'Unique views'], ['pageviews', 'Views'], ['api', 'API requests']];
	const CLIENT_FILTERS: [typeof clientFilter, string][] = [['all', 'All'], ['programmatic', 'Scripts & CI'], ['bots', 'Bots']];
	const RANGE_TEXT: Record<Range, string> = { '24h': 'last 24 hours', '7d': 'last 7 days', '30d': 'last 30 days' };
</script>

<svelte:head>
	<title>Dashboard · wasm.fyi</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

{#if session.state === 'out' || session.state === 'redirecting'}
	<section class="gate">
		<svg class="lock" viewBox="0 0 64 64" aria-hidden="true">
			<path d="M20 28 v-8 a12 12 0 0 1 24 0 v8" />
			<rect x="13" y="28" width="38" height="28" />
			<path d="M32 38 v8" /><circle cx="32" cy="38" r="3" />
		</svg>
		<p class="kicker">wasm.fyi</p>
		<h1>Admin</h1>
		<p class="fg3">Site and API analytics. Sign in with the GitHub account that owns this site.</p>
		{#if configured}<a class="gh btn-primary" href="/auth/github/login" data-sveltekit-reload>
			<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg>
			Continue with GitHub
		</a>{:else}<p class="note">Sign-in not configured. Set up the GitHub OAuth app described in API.md.</p>{/if}
		<p class="note">Access is limited to the configured administrator account. We only read your public profile.</p>
	</section>
{:else if session.state === 'denied'}
	<section class="gate">
		<img class="avatar lg" src={session.avatarUrl ?? ''} alt="" width="56" height="56" />
		<h1>No access</h1>
		<p class="fg3">You’re signed in as <span class="mono fg2">@{login}</span>, which isn’t an admin of wasm.fyi.</p>
		<button class="btn-outline" onclick={signOut}>Sign out</button>
	</section>
{:else if analyticsLoading || bandwidthLoading || totalsLoading}
 <section aria-busy="true" aria-label="Loading analytics"><div class="skel" style="height:80px;margin:24px 0"></div><div class="skel" style="height:300px"></div></section>
{:else if !data.generated || !total.since || !bw.series.length}
 <section class="gate"><p role="alert">{error || 'Analytics unavailable.'}</p><button class="btn-outline" onclick={()=>refresh++}>Retry</button><button class="btn-outline" onclick={signOut}>Sign out</button></section>
{:else}
 {#if error}<p role="alert">{error}</p>{/if}
	<header class="top">
		<div class="title">
			<h1>Analytics</h1>
		</div>
		<div class="controls">
			<Seg label="Range" options={RANGES} value={range} onselect={(v) => (range = v)} />
			<span class="who">
				{#if !session.development}<img class="avatar" src={session.avatarUrl ?? ''} alt="" width="22" height="22" />{/if}
				<span class="mono">{login}</span>
				{#if !session.development}<button class="btn-small" onclick={signOut}>Sign out</button>{:else}<span class="note">local development</span>{/if}
			</span>
		</div>
	</header>

	<!-- All-time totals: counters kept forever, unlike the 30-day history below -->
	<section class="alltime" aria-label="All-time totals">
		<div class="at-head">
			<h2>All time</h2>
			<span class="note">since {new Date(total.since).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} · charts below keep 30 days</span>
		</div>
		<div class="at-grid">
			<div><span class="kpi-label" data-tip="Daily unique visitor identities; the private salt rotates at UTC midnight and on restart">Unique views</span><span class="at-v mono">{total.visitors.toLocaleString()}</span></div>
			<div><span class="kpi-label">Views</span><span class="at-v mono">{total.pageviews.toLocaleString()}</span></div>
			<div data-tip="{ORIGINS.map((o) => `${ORIGIN_LABEL[o]} ${shortCount(total.apiByOrigin[o])}`).join(' · ')}">
				<span class="kpi-label">API requests</span><span class="at-v mono">{total.apiRequests.toLocaleString()}</span>
				<span class="at-bar">{#each ORIGINS as o (o)}<span style:flex-grow={total.apiByOrigin[o]} style:background={ORIGIN_COLOR[o]}></span>{/each}</span>
			</div>
			<div><span class="kpi-label">API data moved</span><span class="at-v mono">{fmtBytes(total.apiDown + total.apiUp)}</span><span class="at-sub mono fg3">↓ {fmtBytes(total.apiDown)} · ↑ {fmtBytes(total.apiUp)}</span></div>
			<div><span class="kpi-label">All data moved</span><span class="at-v mono">{fmtBytes(total.totalDown + total.totalUp)}</span><span class="at-sub mono fg3">↓ {fmtBytes(total.totalDown)} · ↑ {fmtBytes(total.totalUp)}</span></div>
			<div><span class="kpi-label">Programmatic clients</span><span class="at-v mono">{total.clients.toLocaleString()}</span></div>
		</div>
	</section>

	<!-- Headline numbers, each against the previous period of the same length -->
	<section class="tiles kpis" aria-label="Key numbers">
		{#each data.kpis as k (k.key)}
			{@const d = k.comparisonAvailable === false ? {text:'—',tone:''} : delta(k.value, k.prev, k.invert)}
			<div class="kpi" data-tip={k.hint}>
				<span class="kpi-label">{k.label}</span>
				<span class="kpi-value mono">{k.available === false ? '—' : fmtValue(k.value, k.unit)}</span>
				<span class="kpi-foot">
					<span class="delta {d.tone} mono">{d.text}</span>
					<Spark values={k.spark} width={84} height={22} color={d.tone === 'bad' ? 'var(--bad)' : d.tone === 'good' ? 'var(--good)' : 'var(--fg3)'} />
				</span>
			</div>
		{/each}
	</section>
	<p class="note vs">Changes compare the {RANGE_TEXT[range]} with the {RANGE_TEXT[range].replace('last', 'previous')}.</p>

	<!-- Traffic over time -->
	<section class="panel pad">
		<div class="head">
			<h2>Traffic</h2>
			<Seg label="Chart" options={CHARTS} value={chartMode} onselect={(v) => (chartMode = v)} />
		</div>
		<TrafficChart series={data.series} mode={chartMode} step={BUCKET[range]} colors={ORIGIN_COLOR} labels={ORIGIN_LABEL} />
	</section>

	<!-- Bandwidth: live throughput, and totals over a window -->
	<section class="bw">
		<div class="panel pad">
			<div class="head"><h2>Live throughput</h2><span class="live small"><i></i>last {LIVE_SECONDS}s</span></div>
			<div class="rates">
				<div class="rate"><span class="kpi-label">↓ Down</span><span class="kpi-value mono">{fmtRate(liveNow.down)}</span></div>
				<div class="rate"><span class="kpi-label">↑ Up</span><span class="kpi-value mono">{fmtRate(liveNow.up)}</span></div>
			</div>
			<UpDownChart series={live} fmt={fmtRate} when={secsAgo} height={120} readout={false} />
			<p class="note">{fmtBytes(liveMinute.down)} down · {fmtBytes(liveMinute.up)} up in the last minute</p>
		</div>
		<div class="panel pad">
			<div class="head">
				<h2>Bandwidth</h2>
				<Seg label="Window" options={BW_WINDOWS} value={bwWindow} onselect={(v) => (bwWindow = v)} />
			</div>
			<div class="bw-totals">
				{#each [['↓ Down', bw.down, bw.prevDown], ['↑ Up', bw.up, bw.prevUp]] as const as [label, v, prev] (label)}
					{@const d = bw.comparisonAvailable === false ? {text:'—',tone:''} : delta(v, prev)}
					<div><span class="kpi-label">{label}, last {BW_TEXT[bwWindow]}</span><span class="tot mono">{fmtBytes(v)}</span><span class="delta mono">{d.text}</span></div>
				{/each}
				<div><span class="kpi-label">Avg. down</span><span class="tot mono">{fmtRate(bw.down / (bw.series.length * bw.step / 1000))}</span></div>
				<div><span class="kpi-label">Peak down</span><span class="tot mono">{fmtRate(bw.peakDown)}</span></div>
			</div>
			<UpDownChart series={bw.series} fmt={fmtBytes} when={bwWhen} ticks={bwTicks} height={190} latestLabel="Latest bucket" />
		</div>
	</section>

	<!-- Who calls the API -->
	<section class="split">
		<div class="panel pad">
			<div class="head"><h2>API by origin</h2><span class="fg3 small mono">{shortCount(apiTotal)} requests</span></div>
			<div class="origin-bar" role="img" aria-label="Share of API requests by origin">
				{#each ORIGINS as o (o)}
					<span style:flex-grow={originTotals[o]} style:background={ORIGIN_COLOR[o]} data-tip="{ORIGIN_LABEL[o]}: {pct(originTotals[o], apiTotal).toFixed(1)}%"></span>
				{/each}
			</div>
			<ul class="origins">
				{#each ORIGINS as o (o)}
					<li>
						<span class="o-name"><i style:background={ORIGIN_COLOR[o]}></i>{ORIGIN_LABEL[o]}</span>
						<span class="mono">{shortCount(originTotals[o])}</span>
						<span class="mono fg3 r">{pct(originTotals[o], apiTotal).toFixed(1)}%</span>
						<span class="o-how fg3">{ORIGIN_HOW[o]}</span>
					</li>
				{/each}
			</ul>
		</div>

		<div class="panel">
			<div class="head pad-x"><h2>Endpoints</h2><span class="legend">{#each ORIGINS as o (o)}<span><i style:background={ORIGIN_COLOR[o]}></i>{ORIGIN_LABEL[o]}</span>{/each}</span></div>
			<div class="scroll-x">
				<table class="t">
					<thead><tr><th>Endpoint</th><th class="r">Requests</th><th class="mix">Who</th><th class="r">p50</th><th class="r">p95</th><th class="r">5xx</th></tr></thead>
					<tbody>
						{#each data.endpoints as e (e.path)}
							{@const n = ORIGINS.reduce((s, o) => s + e.requests[o], 0)}
							<tr>
								<td class="mono path">{e.path}</td>
								<td class="r mono">{shortCount(n)}</td>
								<td class="mix">
									<span class="mini">
										{#each ORIGINS as o (o)}<span style:flex-grow={e.requests[o]} style:background={ORIGIN_COLOR[o]}></span>{/each}
									</span>
								</td>
								<td class="r mono fg2">{e.p50} ms</td>
								<td class="r mono" class:warn={e.p95 > 150}>{e.p95} ms</td>
								<td class="r mono" class:warn={e.errors >= 1}>{e.errors ? `${e.errors}%` : '0'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	</section>

	<!-- Non-browser clients -->
	<section class="panel">
		<div class="head pad-x">
			<h2>Programmatic clients</h2>
			<Seg label="Client type" options={CLIENT_FILTERS} value={clientFilter} onselect={(v) => (clientFilter = v)} />
		</div>
		<div class="scroll-x">
			<table class="t clients">
				<thead><tr><th>Client</th><th class="hide-sm">User agent</th><th class="hide-sm">Network</th><th class="r">Requests</th><th>Trend</th><th class="r">Errors</th><th class="hide-sm">Mostly calls</th><th class="r">Last seen</th></tr></thead>
				<tbody>
					{#each clients as c (clientKey(c))}
						<tr>
							<td><span class="o-name"><i style:background={ORIGIN_COLOR[c.origin]} data-tip={ORIGIN_LABEL[c.origin]}></i>{c.name}</span></td>
							<td class="mono fg2 hide-sm">{c.agent}</td>
							<td class="fg3 hide-sm">{c.network}</td>
							<td class="r mono">{shortCount(c.requests)}</td>
							<td><Spark values={c.spark} width={72} height={18} color={ORIGIN_COLOR[c.origin]} /></td>
							<td class="r mono" class:warn={c.errors / Math.max(1, c.requests) > 0.01}>{pct(c.errors, c.requests).toFixed(1)}%</td>
							<td class="mono fg3 hide-sm">{c.topEndpoint}</td>
							<td class="r fg3 nowrap">{ago(c.lastSeen)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<!-- Audience -->
	{#snippet shares(title: string, items: Share[], opts: { mono?: boolean; extra?: (s: Share) => string; color?: string } = {})}
		{@const top = Math.max(1, ...items.map((s) => s.value))}
		<div class="panel pad">
			<h2>{title}</h2>
			<ul class="shares">
				{#each items as s (s.label)}
					<li data-tip={s.detail}>
						<span class="bar" style:width="{(s.value / top) * 100}%" style:background={opts.color}></span>
						<span class="s-label" class:mono={opts.mono}>{s.label}</span>
						{#if opts.extra}<span class="fg3 mono s-extra">{opts.extra(s)}</span>{/if}
						<span class="mono s-val">{shortCount(s.value)}</span>
					</li>
				{/each}
			</ul>
		</div>
	{/snippet}

	<h2 class="section">Audience</h2>
	<section class="panel map-panel">
		<div class="head pad-x">
			<h2>Where people are</h2>
			<span class="row">
				<Seg label="Map metric" options={MAP_METRICS} value={mapMetric} onselect={(v) => (mapMetric = v)} />
				<Seg label="Map style" options={MAP_MODES} value={mapMode} onselect={(v) => (mapMode = v)} />
			</span>
		</div>
		<div class="map-body">
			<div class="map-cell">
				<WorldMap {spots} mode={mapMode} unit={mapMetric === 'visitors' ? 'unique views' : 'API calls'} />
				<p class="note">{spots.length ? 'Approximate city locations; exact addresses are never stored.' : 'No locations recorded for this period.'} <a href="https://db-ip.com" target="_blank" rel="noopener noreferrer">IP Geolocation by DB-IP</a></p>
			</div>
			<ol class="cities">
				{#each spots.slice(0, 10) as s, i (s.key)}
					<li>
						<span class="rank mono fg3">{i + 1}</span>
						<span class="c-name">{s.label}<span class="fg3">{' · '}{s.sub}</span></span>
						<span class="mono">{shortCount(s.value)}</span>
						<span class="mono fg3 c-pct">{pct(s.value, spotTotal).toFixed(1)}%</span>
					</li>
				{/each}
			</ol>
		</div>
	</section>
	<section class="grid3">
		{@render shares('Top pages', data.pages, { mono: true, extra: () => '—' })}
		{@render shares('Referrers', data.referrers)}
		{@render shares('Countries', data.countries)}
		{@render shares('Devices', data.devices)}
		{@render shares('Browsers', data.browsers)}

	</section>

	<h2 class="section">What people look at</h2>
	<section class="grid2">
		{@render shares('Runtimes opened', data.runtimes, { color: 'color-mix(in srgb, var(--rt-wasmtime) 22%, transparent)' })}
		{@render shares('Workloads opened', data.workloads, { mono: true, color: 'color-mix(in srgb, var(--rt-wasmtime) 22%, transparent)' })}
	</section>

	<!-- Recent requests -->
	<section class="panel">
		<div class="head pad-x"><h2>Recent API requests</h2><span class="fg3 small">last 48 hours</span></div>
		<div class="scroll-x">
			<table class="t log">
				<thead><tr><th>When</th><th>Status</th><th>Request</th><th>Origin</th><th class="hide-sm">Agent</th><th class="r">Time</th></tr></thead>
				<tbody>
					{#each data.log as l, i (i)}
						<tr>
							<td class="fg3 nowrap">{ago(l.at)}</td>
							<td><span class="status mono" class:s4={l.status >= 400 && l.status < 500} class:s5={l.status >= 500}>{l.status}</span></td>
							<td class="mono nowrap"><span class="fg3">{l.method}</span> {l.path}</td>
							<td><span class="o-name" data-tip={ORIGIN_LABEL[l.origin]}><i style:background={ORIGIN_COLOR[l.origin]}></i><span class="hide-sm">{ORIGIN_LABEL[l.origin]}</span></span></td>
							<td class="fg3 hide-sm nowrap">{l.agent}</td>
							<td class="r mono" class:warn={l.ms > 300}>{l.ms} ms</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
{/if}

<style>
	h1 {
		font-size: 20px;
		font-weight: 600;
	}
	h2 {
		font-size: 13px;
		font-weight: 600;
	}
	h2.section {
		margin-top: 6px;
		font-size: 11px;
		font-weight: 500;
		color: var(--fg3);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	/* ── gate ── */
	.gate {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 10px;
		padding: 56px 16px 72px;
	}
	.gate p {
		max-width: 380px;
		font-size: 13px;
		line-height: 1.5;
	}
	.lock {
		width: 56px;
		height: 56px;
		margin-bottom: 6px;
		fill: none;
		stroke: var(--fg2);
		stroke-width: 2;
		stroke-linecap: round;
	}
	.gh {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		margin: 10px 0 2px;
		cursor: pointer;
	}
	.gh:disabled {
		opacity: 0.7;
		cursor: progress;
	}
	.gh svg {
		width: 16px;
		height: 16px;
		fill: currentColor;
	}
	.avatar {
		border-radius: 50%;
		border: 1px solid var(--line2);
		background: var(--bg3);
	}
	.avatar.lg {
		width: 56px;
		height: 56px;
	}

	/* ── header ── */
	.top {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 10px 16px;
	}
	.title {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 6px 14px;
	}
	.live {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--fg2);
	}
	.live i {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--st-pass);
		animation: pulse 2s ease-out infinite;
	}
	@keyframes pulse {
		0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--st-pass) 60%, transparent); }
		100% { box-shadow: 0 0 0 7px transparent; }
	}
	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px 14px;
	}
	.who {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
	}

	/* ── all time ── */
	.alltime {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.at-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px 12px;
	}
	.at-grid {
		display: grid;
		grid-template-columns: repeat(6, minmax(0, 1fr));
		border: 1px solid var(--line);
		background: var(--bg2);
	}
	.at-grid > div {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 10px 14px;
		min-width: 0;
	}
	.at-grid > div + div {
		border-left: 1px solid var(--line);
	}
	.at-v {
		font-size: 17px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.at-sub {
		font-size: 11px;
		white-space: nowrap;
	}
	.at-bar {
		display: flex;
		gap: 1px;
		height: 4px;
		margin-top: 2px;
	}
	.at-bar span {
		flex-basis: 0;
	}

	/* ── kpis ── */
	.kpis {
		grid-template-columns: repeat(4, minmax(0, 1fr));
	}
	.kpi {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 12px 14px 10px;
		min-width: 0;
	}
	.kpi-label {
		font-size: 12px;
		color: var(--fg3);
	}
	.kpi-value {
		font-size: 22px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.kpi-foot {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 8px;
	}
	.delta {
		font-size: 12px;
		color: var(--fg3);
	}
	.delta.good {
		color: var(--good);
	}
	.delta.bad {
		color: var(--bad);
	}
	.vs {
		margin-top: -10px;
	}

	/* ── panels ── */
	.pad {
		padding: 12px 14px 14px;
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-width: 0;
	}
	.pad-x {
		padding: 10px 14px;
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 8px 12px;
	}
	.panel > .head.pad-x {
		border-bottom: 1px solid var(--line);
	}
	.split {
		display: grid;
		grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
		gap: 14px;
	}
	.bw {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
		gap: 14px;
	}
	.rates {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.rate {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.rate .kpi-value {
		font-size: 20px;
	}
	.bw-totals {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 28px;
	}
	.bw-totals > div {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.tot {
		font-size: 16px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.map-body {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 280px;
		gap: 18px;
		padding: 16px 14px 14px;
	}
	.map-cell {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
	}
	.cities {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		font-size: 12px;
	}
	.cities li {
		display: grid;
		grid-template-columns: 18px minmax(0, 1fr) auto 44px;
		gap: 8px;
		align-items: baseline;
		padding: 6px 0;
		border-bottom: 1px solid var(--line);
	}
	.cities li:last-child {
		border-bottom: 0;
	}
	.c-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.c-pct {
		text-align: right;
	}
	.grid3 {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 14px;
	}
	.grid2 {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 14px;
	}
	.scroll-x {
		overflow-x: auto;
		scrollbar-width: thin;
	}
	.t th {
		font-weight: 500;
		color: var(--fg3);
		white-space: nowrap;
	}
	.t td,
	.t th {
		padding: 6px 14px;
		border-bottom: 1px solid var(--line);
		text-align: left;
	}
	.t .r {
		text-align: right;
	}
	.t tbody tr:last-child td {
		border-bottom: 0;
	}
	.t tbody tr:hover td {
		background: var(--hover);
	}
	.warn {
		color: var(--bad);
	}

	/* ── origins ── */
	.origin-bar {
		display: flex;
		height: 12px;
		gap: 2px;
	}
	.origin-bar span {
		flex-basis: 0;
		min-width: 2px;
	}
	.origins {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.origins li {
		display: grid;
		grid-template-columns: 1fr auto 56px;
		gap: 2px 12px;
		padding: 8px 0;
		font-size: 12px;
		border-top: 1px solid var(--line);
	}
	.o-how {
		grid-column: 1 / -1;
		font-size: 11px;
		line-height: 1.45;
	}
	.o-name {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		white-space: nowrap;
	}
	.o-name i,
	.legend i {
		display: inline-block;
		flex: none;
		width: 8px;
		height: 8px;
	}
	.legend {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 4px 12px;
		font-size: 11px;
		color: var(--fg3);
	}
	.legend span {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.mix {
		width: 30%;
		min-width: 90px;
	}
	.mini {
		display: flex;
		gap: 1px;
		height: 8px;
	}
	.mini span {
		flex-basis: 0;
	}
	.path {
		white-space: nowrap;
	}

	/* ── share lists ── */
	.shares {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.shares li {
		position: relative;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 4px 6px;
		font-size: 12px;
	}
	.shares .bar {
		position: absolute;
		inset: 0 auto 0 0;
		background: var(--bg3);
		z-index: 0;
	}
	.s-label,
	.s-extra,
	.s-val {
		position: relative;
	}
	.s-label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.s-val {
		min-width: 5ch;
		text-align: right;
	}

	/* ── log ── */
	.status {
		color: var(--st-pass);
	}
	.status.s4 {
		color: var(--st-warn);
	}
	.status.s5 {
		color: var(--st-fail);
	}

	@media (max-width: 1100px) {
		.map-body {
			grid-template-columns: minmax(0, 1fr);
		}
		.at-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
		.at-grid > div:nth-child(n + 4) {
			border-top: 1px solid var(--line);
		}
		.at-grid > div:nth-child(4) {
			border-left: 0;
		}
		.bw,
		.split {
			grid-template-columns: minmax(0, 1fr);
		}
		.grid3 {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@media (max-width: 720px) {
		.at-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.at-grid > div:nth-child(n) {
			border-left: 0;
			border-top: 1px solid var(--line);
		}
		.at-grid > div:nth-child(-n + 2) {
			border-top: 0;
		}
		.at-grid > div:nth-child(even) {
			border-left: 1px solid var(--line);
		}
		.kpis {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.kpi {
			padding: 10px 12px 8px;
		}
		.kpi-value {
			font-size: 18px;
		}
		.kpi-foot :global(.spark) {
			width: 56px;
		}
		.grid3,
		.grid2 {
			grid-template-columns: minmax(0, 1fr);
		}
		.hide-sm {
			display: none;
		}
		.t td,
		.t th {
			padding: 6px 10px;
		}
		.who .mono {
			display: none;
		}
	}
</style>
