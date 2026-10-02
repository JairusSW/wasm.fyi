<script lang="ts">
	import '../app.css';
	import { base } from '$app/paths';
	import { SITE_ORIGIN, SITE_DESCRIPTION } from '$lib/site';
	import { browser } from '$app/environment';
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import { goto, replaceState } from '$lib/navigation';
	import { page } from '$app/state';
	import Drawer from '$lib/components/Drawer.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import Header from '$lib/components/Header.svelte';
	import ScopeBar from '$lib/components/ScopeBar.svelte';
	import Tooltip from '$lib/components/Tooltip.svelte';
	import { OTM_KEYS } from '$lib/data/snapshot';
	import { PROPOSAL_IDS } from '$lib/links';
	import { ui } from '$lib/state.svelte';
	import { onMount } from 'svelte';

	let { children } = $props();

	const SCOPED = ['/benchmarks', '/bench/[...id]', '/history', '/features', '/[proposal=proposal]'];
	const showScope = $derived(SCOPED.includes(page.route.id ?? ''));

	// URL ⇄ state. Reading happens after each navigation; writing mirrors state
	// changes back into the address bar without adding history entries.
	let synced = $state(false);
	beforeNavigate(() => (synced = false));
	afterNavigate(({ to }) => {
		// `to.route` is empty on the initial hydration, so use the settled page route.
		const routeId = to?.route.id ?? page.route.id;
		if (to?.url && routeId) ui.loadFromUrl(to.url, routeId);
		ui.drawer = null;
		synced = true;
	});
	$effect(() => {
		if (!browser || !synced) return;
		const search = ui.toSearch(page.route.id);
		if (search !== location.search) replaceState(location.pathname + search + location.hash, page.state);
	});

	onMount(() => {
		ui.theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
		// Prototype links used hash routes (#/benchmarks, #/bench/<id>, …).
		const h = location.hash;
		if (h.startsWith('#/')) {
			const [head, ...rest] = h.slice(2).split('/');
			const path =
				head === 'overview' || head === ''
					? '/'
					: head === 'compat'
						? '/features'
						: head === 'bench'
							? '/bench/' + rest.join('/')
							: PROPOSAL_IDS.includes(head as never) || ['benchmarks', 'history', 'features'].includes(head)
								? '/' + head
								: null;
			if (path) goto(path, { replaceState: true });
		}
	});

	function onkeydown(e: KeyboardEvent) {
		const tag = (e.target as HTMLElement | null)?.tagName;
		const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
		if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
		if (e.key === '/') {
			const el = document.getElementById('gsearch');
			if (el) {
				e.preventDefault();
				el.focus();
			}
		}
		const rid = page.route.id;
		if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && (rid === '/benchmarks' || rid === '/history') && !ui.drawer) {
			const i = OTM_KEYS.indexOf(ui.otMetric);
			ui.otMetric = OTM_KEYS[(i + (e.key === 'ArrowRight' ? 1 : -1) + OTM_KEYS.length) % OTM_KEYS.length];
		}
	}
</script>

<svelte:head>
	<meta name="description" content={SITE_DESCRIPTION} />
	<link rel="canonical" href={SITE_ORIGIN + page.url.pathname} />
	<link rel="alternate" type="text/plain" title="LLM reference" href={base + '/llms.txt'} />
	<link rel="alternate" type="text/plain" title="Expanded LLM reference" href={base + '/llms-full.txt'} />
	<link rel="alternate" type="application/json" title="Machine-readable data" href={base + '/data/llm/index.json'} />
	<link rel="sitemap" type="application/xml" href={base + '/sitemap.xml'} />
</svelte:head>

<svelte:window {onkeydown} />

<a class="skip-link" href="#main-content">Skip to content</a>
<div class="frame">
	<Header />
	{#if showScope}<ScopeBar />{/if}
	<main id="main-content" tabindex="-1">
		{@render children()}
	</main>
	<Footer />
</div>
<Drawer />
<Tooltip />

<style>
  .skip-link { position:fixed;top:8px;left:20px;z-index:10000;padding:8px 12px;background:var(--bg);color:var(--fg);border:1px solid var(--line2);transform:translateY(-200%); }
  .skip-link:focus { transform:translateY(0); }
	.frame {
		min-height: 100vh;
	}
	main {
		padding: 16px 20px 48px;
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
</style>
