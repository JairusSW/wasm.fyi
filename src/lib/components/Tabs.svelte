<script lang="ts" generics="T">
	/** Underlined tab row; pairs with a Carousel header for the same set of views. */
	let { options, value, onselect }: { options: [T, string][]; value: T; onselect: (v: T) => void } = $props();
</script>

<div class="tabs" role="tablist">
	{#each options as [v, text] (text)}
		<button role="tab" aria-selected={v === value} onclick={() => onselect(v)}>{text}</button>
	{/each}
</div>

<style>
	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 2px;
		border-bottom: 1px solid var(--line);
	}
	button {
		border-bottom: 2px solid transparent;
		color: var(--fg2);
		padding: 5px 10px 4px;
		font-size: 12px;
	}
	button:hover,
	button[aria-selected='true'] {
		color: var(--fg);
	}
	button[aria-selected='true'] {
		border-bottom-color: var(--fg);
	}
</style>
