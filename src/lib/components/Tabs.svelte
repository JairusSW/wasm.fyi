<script lang="ts" generics="T">
	/** Underlined tab row; pairs with a Carousel header for the same set of views. */
	let { options, value, onselect }: { options: [T, string][]; value: T; onselect: (v: T) => void } = $props();

	let el: HTMLDivElement;

	// Keep the selected tab visible when the row scrolls (narrow screens, carousel arrows).
	$effect(() => {
		void value;
		const tab = el?.querySelector<HTMLElement>('[aria-selected="true"]');
		if (!tab || el.scrollWidth <= el.clientWidth) return;
		const left = tab.offsetLeft;
		if (left < el.scrollLeft || left + tab.offsetWidth > el.scrollLeft + el.clientWidth)
			el.scrollTo({ left: left - (el.clientWidth - tab.offsetWidth) / 2, behavior: 'smooth' });
	});
</script>

<div class="tabs scroll-x" role="tablist" bind:this={el}>
	{#each options as [v, text] (text)}
		<button role="tab" aria-selected={v === value} onclick={() => onselect(v)}>{text}</button>
	{/each}
</div>

<style>
	.tabs {
		display: flex;
		gap: 2px;
		border-bottom: 1px solid var(--line);
		position: relative;
	}
	button {
		border-bottom: 2px solid transparent;
		color: var(--fg2);
		padding: 5px 10px 4px;
		font-size: 12px;
		white-space: nowrap;
		flex: none;
	}
	button:hover,
	button[aria-selected='true'] {
		color: var(--fg);
	}
	button[aria-selected='true'] {
		border-bottom-color: var(--fg);
	}
	@media (max-width: 720px) {
		.tabs {
			margin: 0 -16px;
			padding: 0 6px;
		}
		button {
			padding: 10px 10px 8px;
			font-size: 13px;
		}
	}
</style>
