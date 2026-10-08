<script lang="ts">
	/** Compact change badge for chart tooltips: arrow + value on a tinted chip. */
	let { text, color, dir }: { text: string; color: string; dir: number | null } = $props();
	const arrow = $derived(dir == null || dir === 0 ? '' : dir > 0 ? '▲' : '▼');
</script>

<span class="delta mono" style:--c={color}>{#if arrow}<span class="arr">{arrow}</span>{/if}{text}</span>

<style>
	.delta {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 1px 5px;
		font-size: 11px;
		line-height: 16px;
		white-space: nowrap;
		color: var(--c);
		background: color-mix(in srgb, var(--c) 14%, transparent);
		border-radius: 3px;
	}
	.arr {
		font-size: 8px;
	}
</style>
