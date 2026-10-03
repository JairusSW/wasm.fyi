<script lang="ts">
	import { studio } from './store.svelte';

	const page = $derived(studio.current);
	let fileInput = $state<HTMLInputElement>();
	let more = $state(false);
	let confirmReset = $state(false);

	async function share() {
		try {
			const url = await studio.shareUrl(page);
			await navigator.clipboard.writeText(url);
			studio.notify('Share link copied — anyone opening it can preview this layout');
		} catch {
			studio.notify('Could not copy the share link');
		}
	}
	function exportFile() {
		const blob = new Blob([studio.exportJSON(page)], { type: 'application/json' });
		const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `wasm-fyi-${page.replace(':', '-')}.layout.json` });
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 1000);
		more = false;
	}
	async function importFile(e: Event) {
		const f = (e.currentTarget as HTMLInputElement).files?.[0];
		if (!f) return;
		const err = studio.importJSON(page, await f.text());
		if (err) studio.notify(err);
		(e.currentTarget as HTMLInputElement).value = '';
		more = false;
	}
	function done() {
		studio.editing = false;
		confirmReset = false;
	}
</script>

{#if studio.editing}
	<div class="ed-bar" role="toolbar" aria-label="Layout editor">
		<span class="mode"><span class="dot"></span>Editing <b>{studio.pageName(page)}</b>{#if !studio.isCustom(page)}<span class="fg3"> · default layout</span>{/if}</span>
		<button class="tb primary" onclick={() => (studio.library = {})}>＋ Add block</button>
		<span class="sep"></span>
		<button class="tb" disabled={!studio.canUndo(page)} onclick={() => studio.undo(page)} data-tip="Undo (⌘Z)">↶</button>
		<button class="tb" disabled={!studio.canRedo(page)} onclick={() => studio.redo(page)} data-tip="Redo (⇧⌘Z)">↷</button>
		<span class="sep"></span>
		<button class="tb" onclick={share} data-tip="Copy a link that opens this layout">Share</button>
		<div class="more-wrap">
			<button class="tb" aria-expanded={more} onclick={() => (more = !more)}>More ▾</button>
			{#if more}
				<div class="menu float" role="menu">
					<button role="menuitem" onclick={exportFile}>Export layout (.json)</button>
					<button role="menuitem" onclick={() => fileInput?.click()}>Import layout or chart…</button>
					<button role="menuitem" onclick={() => { studio.palette = true; more = false; }}>Command palette (⌘K)</button>
					{#if studio.isCustom(page)}
						{#if confirmReset}
							<button role="menuitem" class="danger" onclick={() => { studio.reset(page); confirmReset = false; more = false; }}>Confirm reset to default</button>
						{:else}
							<button role="menuitem" onclick={() => (confirmReset = true)}>Reset to default…</button>
						{/if}
					{/if}
				</div>
			{/if}
		</div>
		<input bind:this={fileInput} type="file" accept="application/json,.json" hidden onchange={importFile} />
		<span class="hint small fg3">Drag ✥ to move · drag the right edge to resize, the bottom edge to shorten · {studio.savedAt ? 'Saved' : 'Changes save automatically'}</span>
		<button class="tb done" onclick={done}>Done</button>
	</div>
{/if}

{#if studio.toast}
	{@const t = studio.toast}
	<div class="toast float" role="status">
		<span>{t.text}</span>
		{#if t.undo && studio.canUndo(t.undo)}
			<button class="undo" onclick={() => { studio.undo(t.undo!); studio.toast = null; }}>Undo</button>
		{/if}
	</div>
{/if}

<svelte:window onclick={(e) => more && !(e.target as Element).closest('.more-wrap') && ((more = false), (confirmReset = false))} />

<style>
	.ed-bar {
		position: sticky;
		top: 0;
		z-index: 40;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px 8px;
		padding: 8px 20px;
		background: var(--bg2);
		border-bottom: 1px solid var(--focus);
		font-size: 12px;
	}
	.mode {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-right: 6px;
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--focus);
	}
	.tb {
		border: 1px solid var(--line2);
		padding: 3px 10px;
		font-size: 12px;
		color: var(--fg2);
	}
	.tb:hover:not(:disabled) {
		color: var(--fg);
		border-color: var(--fg3);
	}
	.tb:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.primary {
		background: var(--fg);
		border-color: var(--fg);
		color: var(--bg);
	}
	.primary:hover {
		color: var(--bg) !important;
	}
	.sep {
		width: 1px;
		height: 18px;
		background: var(--line2);
	}
	.more-wrap {
		position: relative;
	}
	.menu {
		position: absolute;
		top: 28px;
		left: 0;
		z-index: 50;
		min-width: 230px;
		display: flex;
		flex-direction: column;
		padding: 4px 0;
	}
	.menu button {
		padding: 6px 12px;
		text-align: left;
		font-size: 12px;
	}
	.menu button:hover {
		background: var(--hover);
	}
	.danger {
		color: var(--st-fail);
	}
	.hint {
		margin-left: auto;
	}
	.done {
		border-color: var(--focus);
		color: var(--fg);
	}
	.undo {
		border: 1px solid var(--line2);
		padding: 1px 10px;
		font-size: 12px;
		color: var(--focus);
	}
	.toast {
		display: flex;
		align-items: center;
		gap: 12px;
		position: fixed;
		left: 50%;
		bottom: 24px;
		transform: translateX(-50%);
		z-index: 9500;
		padding: 8px 14px;
		font-size: 12px;
		max-width: calc(100vw - 32px);
	}
	@media (max-width: 760px) {
		.hint {
			display: none;
		}
	}
</style>
