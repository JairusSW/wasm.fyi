<script lang="ts" generics="T">
	/** Segmented control: one value from a small set. */
	let {
		options,
		value,
		onselect,
		mono = false,
		size = 'sm',
		label,
		disabled = []
	}: {
		options: [T, string][];
		value: T | null;
		onselect: (v: T) => void;
		mono?: boolean;
		size?: 'sm' | 'md' | 'lg';
		label?: string;
		disabled?: T[];
	} = $props();
</script>

<div class="seg {size}" role="group" aria-label={label}>
	{#each options as [v, text] (text)}
		<button aria-pressed={v === value} class:mono disabled={disabled.includes(v)} onclick={() => onselect(v)}>{text}</button>
	{/each}
</div>

<style>
	.seg {
		display: inline-flex;
		flex-wrap: wrap;
		border: 1px solid var(--line2);
		max-width: 100%;
	}
	button {
		padding: 3px 9px;
		font-size: 12px;
		color: var(--fg2);
	}
	.md button {
		padding: 4px 10px;
	}
	.lg button {
		padding: 5px 12px;
	}
	button[aria-pressed='true'] {
		background: var(--line2);
		color: var(--fg);
	}
	button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.mono {
		font-family: var(--mono);
	}
	/* Phones: wrapped options read as a chip group rather than a broken bar. */
	@media (max-width: 720px) {
		.seg {
			border: 0;
			gap: 4px;
		}
		button,
		.md button,
		.lg button {
			padding: 7px 11px;
			font-size: 13px;
			border: 1px solid var(--line2);
		}
		button[aria-pressed='true'] {
			border-color: var(--fg3);
		}
	}
</style>
