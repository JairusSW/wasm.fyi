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
		<span class="synthetic mono">MEASURED DATA</span>
		<a class="btn-small github" href="https://github.com/JairusSW/wasm.fyi" aria-label="wasm.fyi on GitHub">
			<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="currentColor"
				><path
					d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
				/></svg
			>GitHub
		</a>
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
	.github {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		text-decoration: none;
	}
	.github:hover {
		color: var(--fg);
		border-color: var(--fg3);
	}
	.synthetic {
		font-size: 11px;
		color: var(--st-warn);
		border: 1px solid var(--st-warn);
		padding: 1px 6px;
		letter-spacing: 0.04em;
	}
</style>
