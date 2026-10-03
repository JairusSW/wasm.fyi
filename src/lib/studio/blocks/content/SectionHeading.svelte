<script lang="ts">
	import type { BlockProps } from '../../types';

	type C = { eyebrow: string; title: string; text: string; rule: boolean };
	let { config }: BlockProps<C> = $props();
</script>

<div class="sh" class:rule={config.rule}>
	{#if config.eyebrow}<span class="kicker">{config.eyebrow}</span>{/if}
	{#if config.title}<h2>{config.title}</h2>{/if}
	{#if config.text}<p class="lede">{config.text}</p>{/if}
</div>

<style>
	.sh {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.rule {
		border-top: 1px solid var(--line);
		padding-top: 14px;
	}
	h2 {
		font-size: 16px;
		font-weight: 600;
	}
	.lede {
		max-width: 760px;
	}
</style>
