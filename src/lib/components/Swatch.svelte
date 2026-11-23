<script lang="ts">
	import type { Cfg } from '$lib/data/types';

	let { marker, size = 8 }: { marker: Pick<Cfg, 'col' | 'pattern'> & { hollow?: boolean }; size?: number } = $props();
	const color = $derived(marker.col);
	const background = $derived.by(() => {
		switch (marker.pattern) {
			case 'diagonal': return `linear-gradient(135deg, transparent 32%, ${color} 32% 68%, transparent 68%)`;
			case 'split': return `linear-gradient(to right, ${color} 50%, transparent 50%)`;
			default: return marker.hollow ? 'transparent' : color;
		}
	});
</script>

<span aria-hidden="true" class="sw" style:width="{size}px" style:height="{size}px" style:border-color={color} style:background={background}></span>

<style>
	.sw {
		display: inline-block;
		flex: none;
		border: 1.5px solid;
		box-sizing: border-box;
	}
</style>
