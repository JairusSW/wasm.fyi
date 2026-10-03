<script lang="ts">
	import { renderMarkdown } from '../../markdown';
	import type { BlockProps } from '../../types';

	type C = { text: string; style: 'plain' | 'panel' | 'callout' };
	let { config }: BlockProps<C> = $props();
	const html = $derived(renderMarkdown(config.text || ''));
</script>

<div class="note-block {config.style}">
	<!-- renderMarkdown escapes all input and allow-lists link schemes. -->
	{@html html}
</div>

<style>
	.note-block {
		font-size: 13px;
		line-height: 1.55;
		color: var(--fg2);
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.panel {
		border: 1px solid var(--line);
		background: var(--bg2);
		padding: 12px 14px;
	}
	.callout {
		border-left: 2px solid var(--focus);
		background: var(--bg2);
		padding: 10px 14px;
	}
	.note-block :global(h3) {
		font-size: 16px;
		font-weight: 600;
		color: var(--fg);
	}
	.note-block :global(h4),
	.note-block :global(h5) {
		font-size: 13px;
		font-weight: 600;
		color: var(--fg);
		margin: 0;
	}
	.note-block :global(p),
	.note-block :global(ul),
	.note-block :global(ol),
	.note-block :global(blockquote) {
		margin: 0;
	}
	.note-block :global(ul),
	.note-block :global(ol) {
		padding-left: 18px;
	}
	.note-block :global(code) {
		font-family: var(--mono);
		font-size: 12px;
		background: var(--bg3);
		padding: 0 4px;
	}
	.note-block :global(blockquote) {
		border-left: 2px solid var(--line2);
		padding-left: 10px;
		color: var(--fg3);
	}
	.note-block :global(hr) {
		border: 0;
		border-top: 1px solid var(--line);
		width: 100%;
	}
</style>
