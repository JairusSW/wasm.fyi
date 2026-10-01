<script lang="ts">
	import type { Snippet } from 'svelte';

	/** ‹ title › header that cycles through a fixed set of views. */
	let {
		title,
		sub,
		onprev,
		onnext,
		noun = 'view',
		children
	}: { title: string; sub: string; onprev: () => void; onnext: () => void; noun?: string; children?: Snippet } = $props();
</script>

<div class="car">
	<div class="head">
		<button class="arrow" onclick={onprev} aria-label="Previous {noun}">‹</button>
		<div class="titles">
			<span class="title" title={title}>{title}</span>
			<span class="sub" title={sub}>{sub}</span>
		</div>
		<button class="arrow" onclick={onnext} aria-label="Next {noun}">›</button>
	</div>
	{@render children?.()}
</div>

<style>
	.car {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 12px;
		max-width: 100%;
		min-width: 0;
	}
	.head {
		display: grid;
		grid-template-columns: 28px minmax(0, 1fr) 28px;
		align-items: center;
		gap: 10px;
		width: 440px;
		max-width: 100%;
		flex: none;
		min-width: 0;
	}
	.arrow {
		width: 28px;
		height: 28px;
		flex: none;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--line2);
		font-size: 14px;
		color: var(--fg2);
		text-align: center;
	}
	.arrow:hover {
		background: var(--hover);
		color: var(--fg);
	}
	.titles {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.title {
		font-size: 15px;
		font-weight: 600;
		line-height: 20px;
	}
	.sub {
		font-size: 10px;
		line-height: 14px;
		color: var(--fg3);
	}
	.title,
	.sub {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
