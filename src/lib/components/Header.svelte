<script lang="ts">
	import { siteHref } from '$lib/links';
	import { goto } from '$lib/navigation';
	import { page } from '$app/state';
	import { ui } from '$lib/state.svelte';

	const NAV = [
		['/benchmarks', 'Benchmarks', ['/benchmarks', '/bench/[...id]', '/compare']],
		['/history', 'History', ['/history']],
		['/features', 'Features', ['/features', '/[proposal=proposal]']]
	] as const;

	const active = (routes: readonly string[]) => routes.includes(page.route.id ?? '');

	function onkey(e: KeyboardEvent) {
		const input = e.currentTarget as HTMLInputElement;
		if (e.key === 'Enter' && page.route.id !== '/benchmarks') goto('/benchmarks' + (ui.q ? '?q=' + encodeURIComponent(ui.q) : '') + '#workloads');
		if (e.key === 'Escape') {
			ui.q = '';
			input.blur();
		}
	}

	function toggleTheme() {
		ui.theme = ui.theme === 'dark' ? 'light' : 'dark';
		document.documentElement.dataset.theme = ui.theme;
		try {
			localStorage.setItem('theme', ui.theme);
		} catch {}
	}
</script>

<header>
	<a class="brand mono" href={siteHref(`/`)}>wasm.fyi</a>
	<nav aria-label="Primary">
		{#each NAV as [path, label, routes] (path)}
			<a href={siteHref(path)} aria-current={active(routes) ? 'page' : undefined}>{label}</a>
		{/each}
	</nav>
	<div class="tools">
		<input
			id="gsearch"
			type="search"
			bind:value={ui.q}
			onkeydown={onkey}
			placeholder="Search workloads   /"
			aria-label="Search workloads"
		/>
		<span class="synthetic mono">SYNTHETIC DATA</span>
		<button class="btn-small" onclick={toggleTheme}>{ui.theme === 'dark' ? 'Light theme' : 'Dark theme'}</button>
	</div>
</header>

<style>
	header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 20px;
		padding: 10px 20px;
		border-bottom: 1px solid var(--line);
	}
	.brand {
		font-weight: 600;
		font-size: 14px;
		text-decoration: none;
	}
	nav {
		display: flex;
		gap: 2px;
		flex-wrap: wrap;
	}
	nav a {
		border-bottom: 2px solid transparent;
		color: var(--fg2);
		padding: 6px 10px 5px;
		font-size: 13px;
		text-decoration: none;
	}
	nav a:hover,
	nav a[aria-current='page'] {
		color: var(--fg);
	}
	nav a[aria-current='page'] {
		border-bottom-color: var(--fg);
	}
	.tools {
		margin-left: auto;
		display: flex;
		gap: 10px;
		align-items: center;
		flex-wrap: wrap;
	}
	input {
		background: var(--bg2);
		border: 1px solid var(--line2);
		border-radius: 0;
		padding: 4px 8px;
		width: 200px;
		max-width: 100%;
		font-size: 12px;
	}
	.synthetic {
		font-size: 11px;
		color: var(--st-warn);
		border: 1px solid var(--st-warn);
		padding: 1px 6px;
		letter-spacing: 0.04em;
	}
</style>
