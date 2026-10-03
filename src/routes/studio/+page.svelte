<script lang="ts">
	import { goto } from '$lib/navigation';
	import { href } from '$lib/links';
	import { ui } from '$lib/state.svelte';
	import Studio from '$lib/studio/Studio.svelte';
	import { studio } from '$lib/studio/store.svelte';

	const dash = $derived(studio.dashboards.find((d) => d.id === ui.dash) ?? studio.dashboards[0]);
	let renaming = $state(false);
	let name = $state('');
	let confirmDelete = $state(false);

	const open = (id: string) => goto(href('/studio', { d: id === 'main' ? null : id }));
	function create(from?: string) {
		const id = studio.createDashboard(from ? `${studio.pageName(from)} (copy)` : 'Untitled dashboard', from ? studio.layout(from) : undefined);
		open(id);
		studio.editing = true;
	}
	function startRename() {
		name = dash.name;
		renaming = true;
	}
	function saveRename() {
		studio.renameDashboard(dash.id, name);
		renaming = false;
	}
	function remove() {
		const id = dash.id;
		confirmDelete = false;
		studio.deleteDashboard(id);
		open(studio.dashboards[0].id);
	}
</script>

<svelte:head>
	<title>Studio · wasm.fyi</title>
</svelte:head>

<div class="head">
	<span class="mono small fg3 path">wasm.fyi/studio</span>
	<div class="title-row">
		{#if renaming}
			<form class="rename" onsubmit={(e) => (e.preventDefault(), saveRename())}>
				<input bind:value={name} aria-label="Dashboard name" maxlength="80" />
				<button class="btn-small" type="submit">Save</button>
				<button class="btn-small" type="button" onclick={() => (renaming = false)}>Cancel</button>
			</form>
		{:else}
			<h1>{dash.name}</h1>
			<button class="link-quiet" onclick={startRename}>rename</button>
		{/if}
		<div class="push actions">
			<button class="btn-small" onclick={() => (studio.editing = !studio.editing)}>{studio.editing ? 'Done editing' : 'Edit dashboard'}</button>
			<button class="btn-small" onclick={() => create()}>＋ New</button>
			<select aria-label="Start a dashboard from a page" onchange={(e) => { const v = e.currentTarget.value; e.currentTarget.value = ''; if (v) create(v); }}>
				<option value="">Copy a page…</option>
				{#each ['home', 'benchmarks', 'history', 'features'] as p (p)}<option value={p}>{studio.pageName(p)}</option>{/each}
			</select>
			{#if confirmDelete}
				<button class="btn-small danger" onclick={remove}>Delete “{dash.name}”?</button>
				<button class="btn-small" onclick={() => (confirmDelete = false)}>Keep</button>
			{:else}
				<button class="btn-small" disabled={studio.dashboards.length <= 1} onclick={() => (confirmDelete = true)}>Delete</button>
			{/if}
		</div>
	</div>
	<p class="s12 fg3">Your own dashboards, saved in this browser. Charts read the same measured results as the rest of the site; share any dashboard with a link from the editor toolbar.</p>
	{#if studio.dashboards.length > 1}
		<nav class="tabs" aria-label="Dashboards">
			{#each studio.dashboards as d (d.id)}
				<a href={href('/studio', { d: d.id === 'main' ? null : d.id })} aria-current={d.id === dash.id ? 'page' : undefined}>{d.name}</a>
			{/each}
		</nav>
	{/if}
</div>

{#key dash.id}
	<Studio page={'dash:' + dash.id} />
{/key}

<style>
	.head {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.title-row {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 6px 12px;
	}
	h1 {
		font-size: 18px;
		font-weight: 600;
	}
	.push {
		margin-left: auto;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
	}
	.actions select {
		font-size: 12px;
		padding: 3px 6px;
	}
	.rename {
		display: flex;
		gap: 6px;
		align-items: center;
	}
	.rename input {
		background: var(--bg2);
		border: 1px solid var(--line2);
		border-radius: 0;
		padding: 3px 8px;
		font-size: 15px;
		font-weight: 600;
	}
	.s12 {
		font-size: 12px;
		max-width: 760px;
	}
	.danger {
		color: var(--st-fail);
		border-color: var(--st-fail);
	}
	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 2px;
		border-bottom: 1px solid var(--line);
		margin-top: 6px;
	}
	.tabs a {
		padding: 5px 10px 4px;
		font-size: 12px;
		color: var(--fg2);
		text-decoration: none;
		border-bottom: 2px solid transparent;
	}
	.tabs a[aria-current='page'] {
		color: var(--fg);
		border-bottom-color: var(--fg);
	}
</style>
