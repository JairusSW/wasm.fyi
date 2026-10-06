<script lang="ts">
	import { siteHref } from '$lib/links';
	import { goto } from '$lib/navigation';
	import { page } from '$app/state';
	import { ui } from '$lib/state.svelte';
	import { tick } from 'svelte';

	const NAV = [
		['/benchmarks', 'Benchmarks', ['/benchmarks', '/bench/[...id]', '/compare']],
		['/history', 'History', ['/history']],
		['/features', 'Features', ['/features', '/[proposal=proposal]']]
	] as const;

	const active = (routes: readonly string[]) => routes.includes(page.route.id ?? '');

	// On narrow screens the search field folds behind a button; it stays open while it holds a query.
	let searchOpen = $state(false);
	let input: HTMLInputElement;

	async function toggleSearch() {
		searchOpen = !searchOpen;
		if (searchOpen) {
			await tick();
			input?.focus();
		}
	}

	function submit() {
		if (page.route.id !== '/benchmarks') goto('/benchmarks' + (ui.q ? '?q=' + encodeURIComponent(ui.q) : '') + '#workloads');
		else document.getElementById('workloads')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		input?.blur();
	}

	function onkey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			ui.q = '';
			searchOpen = false;
			input.blur();
		}
	}

	function toggleTheme() {
		ui.theme = ui.theme === 'dark' ? 'light' : 'dark';
		document.documentElement.dataset.theme = ui.theme;
		document.querySelector('meta[name="theme-color"]')?.setAttribute('content', ui.theme === 'light' ? '#f6f6f4' : '#0d0e10');
		try {
			localStorage.setItem('theme', ui.theme);
		} catch {}
	}

	const themeLabel = $derived(ui.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
</script>

<header class:search-open={searchOpen || !!ui.q}>
	<a class="brand mono" href={siteHref(`/`)}>wasm.fyi</a>
	<nav aria-label="Primary">
		{#each NAV as [path, label, routes] (path)}
			<a href={siteHref(path)} aria-current={active(routes) ? 'page' : undefined}>{label}</a>
		{/each}
	</nav>
	<form class="search" role="search" onsubmit={(e) => (e.preventDefault(), submit())}>
		<svg class="glass" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"
			><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5" /><path
				d="M10.5 10.5 14 14"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
			/></svg
		>
		<input
			id="gsearch"
			type="search"
			bind:this={input}
			bind:value={ui.q}
			onkeydown={onkey}
			placeholder="Search workloads"
			aria-label="Search workloads"
			enterkeyhint="search"
			autocomplete="off"
			autocapitalize="off"
			spellcheck="false"
		/>
		<kbd class="mono" aria-hidden="true">/</kbd>
	</form>
	<div class="tools">
		<span class="badge mono" data-tip="Every number on this site comes from sealed measurement reports">MEASURED DATA</span>
		<button
			class="icon search-toggle"
			onclick={toggleSearch}
			aria-label="Search workloads"
			aria-expanded={searchOpen || !!ui.q}
			aria-controls="gsearch"
		>
			<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"
				><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5" /><path
					d="M10.5 10.5 14 14"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
				/></svg
			>
		</button>
		<a class="icon" href="https://github.com/JairusSW/wasm.fyi" aria-label="wasm.fyi on GitHub" data-tip="wasm.fyi on GitHub">
			<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"
				><path
					d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
				/></svg
			>
		</a>
		<button class="icon" onclick={toggleTheme} aria-label={themeLabel} data-tip={themeLabel}>
			{#if ui.theme === 'dark'}
				<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"
					><circle cx="8" cy="8" r="3" /><path
						d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.06 1.06M11.54 11.54l1.06 1.06M3.4 12.6l1.06-1.06M11.54 4.46l1.06-1.06"
					/></svg
				>
			{:else}
				<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"
					><path d="M13.5 9.6A5.5 5.5 0 0 1 6.4 2.5a5.5 5.5 0 1 0 7.1 7.1Z" /></svg
				>
			{/if}
		</button>
	</div>
</header>

<style>
	header {
		display: flex;
		align-items: center;
		gap: 8px 20px;
		padding: 8px max(var(--gutter), env(safe-area-inset-right)) 8px max(var(--gutter), env(safe-area-inset-left));
		border-bottom: 1px solid var(--line);
		min-height: 52px;
		box-sizing: border-box;
	}
	.brand {
		font-weight: 600;
		font-size: 14px;
		text-decoration: none;
		padding: 6px 0;
		flex: none;
	}
	nav {
		display: flex;
		gap: 2px;
	}
	nav a {
		border-bottom: 2px solid transparent;
		color: var(--fg2);
		padding: 8px 10px 6px;
		font-size: 13px;
		text-decoration: none;
		white-space: nowrap;
	}
	nav a:hover,
	nav a[aria-current='page'] {
		color: var(--fg);
	}
	nav a[aria-current='page'] {
		border-bottom-color: var(--fg);
	}
	.search {
		margin: 0 0 0 auto;
		position: relative;
		display: flex;
		align-items: center;
	}
	.glass {
		position: absolute;
		left: 9px;
		color: var(--fg3);
		pointer-events: none;
	}
	input {
		background: var(--bg2);
		border: 1px solid var(--line2);
		border-radius: 0;
		padding: 6px 28px;
		width: 220px;
		max-width: 100%;
		font-size: 12px;
		box-sizing: border-box;
		-webkit-appearance: none;
		appearance: none;
	}
	input:focus {
		border-color: var(--fg3);
	}
	kbd {
		position: absolute;
		right: 7px;
		font-size: 10px;
		color: var(--fg3);
		border: 1px solid var(--line2);
		padding: 0 4px;
		line-height: 14px;
		pointer-events: none;
	}
	input:focus + kbd,
	input:not(:placeholder-shown) + kbd {
		display: none;
	}
	.tools {
		display: flex;
		gap: 6px;
		align-items: center;
		flex: none;
	}
	.icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		box-sizing: border-box;
		border: 1px solid var(--line2);
		color: var(--fg2);
		text-decoration: none;
	}
	.icon:hover {
		color: var(--fg);
		border-color: var(--fg3);
	}
	.search-toggle {
		display: none;
	}
	.badge {
		font-size: 11px;
		color: var(--st-warn);
		border: 1px solid var(--st-warn);
		padding: 1px 6px;
		letter-spacing: 0.04em;
		margin-right: 4px;
		white-space: nowrap;
		cursor: help;
	}

	@media (max-width: 900px) {
		.badge {
			display: none;
		}
	}

	/* Phones: brand + icons on one row, full-width nav tabs beneath, search folds behind a button. */
	@media (max-width: 720px) {
		header {
			display: grid;
			grid-template-columns: 1fr auto;
			grid-template-areas:
				'brand tools'
				'search search'
				'nav nav';
			gap: 0 8px;
			padding: max(4px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) 0 max(16px, env(safe-area-inset-left));
		}
		.brand {
			grid-area: brand;
			font-size: 15px;
			justify-self: start;
		}
		.tools {
			grid-area: tools;
			gap: 2px;
		}
		.icon {
			width: 40px;
			height: 40px;
			border-color: transparent;
		}
		.search-toggle {
			display: inline-flex;
		}
		header.search-open .search-toggle {
			color: var(--fg);
			background: var(--bg3);
		}
		.search {
			grid-area: search;
			display: none;
			margin: 2px 4px 6px 0;
		}
		header.search-open .search {
			display: flex;
		}
		input {
			width: 100%;
			font-size: 16px;
			padding: 9px 12px 9px 34px;
		}
		.glass {
			left: 12px;
		}
		kbd {
			display: none;
		}
		nav {
			grid-area: nav;
			margin: 0 -12px 0 -16px;
			display: grid;
			grid-template-columns: repeat(3, 1fr);
		}
		nav a {
			text-align: center;
			font-size: 14px;
			padding: 10px 4px 9px;
		}
	}
</style>
