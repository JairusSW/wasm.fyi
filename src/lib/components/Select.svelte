<script lang="ts" generics="T">
	/**
	 * Site-styled dropdown: square, hairline-bordered, matching Seg. A listbox pops below the
	 * trigger; arrows move, Enter/Space picks, Escape closes, typing jumps to a matching option.
	 */
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';

	let {
		options,
		value,
		onselect,
		label,
		mono = false,
		class: cls = ''
	}: {
		options: [T, string][];
		value: T;
		onselect: (v: T) => void;
		label: string;
		mono?: boolean;
		class?: string;
	} = $props();

	let open = $state(false);
	let active = $state(0);
	let root = $state<HTMLDivElement>();
	let list = $state<HTMLUListElement>();
	const id = `sel-${Math.random().toString(36).slice(2, 8)}`;
	const current = $derived(options.find(([v]) => v === value)?.[1] ?? '—');

	function show() {
		active = Math.max(0, options.findIndex(([v]) => v === value));
		open = true;
		queueMicrotask(() => list?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' }));
	}
	function pick(i: number) {
		const o = options[i];
		if (o) onselect(o[0]);
		open = false;
		root?.querySelector<HTMLButtonElement>('.trigger')?.focus();
	}
	function key(e: KeyboardEvent) {
		if (!open) {
			if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
				e.preventDefault();
				show();
			}
			return;
		}
		if (e.key === 'Escape') {
			e.preventDefault();
			open = false;
		} else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			active = (active + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
			list?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
		} else if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			pick(active);
		} else if (e.key === 'Tab') {
			open = false;
		} else if (e.key.length === 1) {
			const at = options.findIndex(([, l], i) => i > active && l.toLowerCase().startsWith(e.key.toLowerCase()));
			const first = options.findIndex(([, l]) => l.toLowerCase().startsWith(e.key.toLowerCase()));
			if (at >= 0 || first >= 0) active = at >= 0 ? at : first;
		}
	}
</script>

<svelte:window onpointerdown={(e) => open && root && !root.contains(e.target as Node) && (open = false)} />

<div class="select {cls}" bind:this={root}>
	<button
		class="trigger"
		class:mono
		class:open
		aria-haspopup="listbox"
		aria-expanded={open}
		aria-controls={id}
		aria-label="{label}: {current}"
		onclick={() => (open ? (open = false) : show())}
		onkeydown={key}
	>
		<span class="cur">{current}</span>
		<svg class="caret" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" /></svg>
	</button>
	{#if open}
		<ul class="list" class:mono role="listbox" {id} aria-label={label} bind:this={list} transition:fly={{ y: -4, duration: 140, easing: cubicOut }}>
			{#each options as [v, text], i (i)}
				<li
					role="option"
					data-i={i}
					aria-selected={v === value}
					class:active={i === active}
					onpointerenter={() => (active = i)}
					onclick={() => pick(i)}
					onkeydown={key}
				>
					<span class="tick" aria-hidden="true">{v === value ? '✓' : ''}</span>{text}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.select {
		position: relative;
		display: inline-flex;
		max-width: 100%;
	}
	.trigger {
		display: inline-flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		width: 100%;
		min-width: 0;
		padding: 3px 9px;
		font-size: 12px;
		color: var(--fg);
		background: var(--bg2);
		border: 1px solid var(--line2);
		transition: border-color 0.15s ease, background-color 0.15s ease;
	}
	.trigger:hover,
	.trigger.open {
		border-color: var(--fg3);
	}
	.cur {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.caret {
		width: 9px;
		height: 6px;
		flex: none;
		fill: none;
		stroke: var(--fg3);
		stroke-width: 1.4;
		transition: transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
	}
	.open .caret {
		transform: rotate(180deg);
	}
	.list {
		position: absolute;
		top: calc(100% + 3px);
		left: 0;
		z-index: 60;
		min-width: 100%;
		max-height: 320px;
		overflow: auto;
		margin: 0;
		padding: 3px 0;
		list-style: none;
		background: var(--bg2);
		border: 1px solid var(--line2);
		box-shadow: 0 10px 28px rgb(0 0 0 / 0.28);
	}
	li {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 12px 4px 6px;
		font-size: 12px;
		white-space: nowrap;
		color: var(--fg2);
		cursor: pointer;
	}
	li.active {
		background: var(--line2);
		color: var(--fg);
	}
	li[aria-selected='true'] {
		color: var(--fg);
	}
	.tick {
		width: 12px;
		text-align: center;
		color: var(--fg3);
	}
	.mono {
		font-family: var(--mono);
	}
	@media (max-width: 720px) {
		.trigger {
			padding: 7px 10px;
			font-size: 13px;
		}
		li {
			padding: 8px 14px 8px 8px;
			font-size: 14px;
		}
	}
</style>
