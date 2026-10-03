<script lang="ts">
	import type { BlockProps } from '../../types';

	type C = { title: string; text: string; label: string; href: string };
	let { config }: BlockProps<C> = $props();
</script>

<section class="panel cta">
	<div class="cta-text">
		<h2>{config.title}</h2>
		{#if config.text}<p class="fg2">{config.text}</p>{/if}
	</div>
	{#if config.label}<a class="btn-primary" href={config.href}>{config.label}</a>{/if}
</section>

<style>
	.cta {
		margin: 40px 0 8px;
		padding: 28px;
		display: flex;
		flex-wrap: wrap;
		gap: 16px 32px;
		align-items: center;
		justify-content: space-between;
	}
	.cta-text {
		display: flex;
		flex-direction: column;
		gap: 6px;
		max-width: 620px;
	}
	h2 {
		font-size: 22px;
		font-weight: 600;
	}
	p {
		font-size: 14px;
	}
</style>
