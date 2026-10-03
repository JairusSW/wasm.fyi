<script lang="ts">
	let { eyebrow = '', title = '', lede = '' }: { eyebrow?: string; title?: string; lede?: string } = $props();
</script>

{#if eyebrow || title || lede}
	<div class="heading">
		{#if eyebrow}<span class="eyebrow">{eyebrow}</span>{/if}
		{#if title}<h2>{title}</h2>{/if}
		{#if lede}<p class="fg2">{lede}</p>{/if}
	</div>
{/if}

<style>
	.heading {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.eyebrow {
		font-size: 11px;
		color: var(--fg3);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	h2 {
		font-size: 26px;
		font-weight: 600;
		letter-spacing: -0.015em;
	}
	p {
		font-size: 14px;
		max-width: 640px;
	}
</style>
