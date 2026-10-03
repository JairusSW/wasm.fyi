<script lang="ts">
	import type { BlockProps } from '../../types';

	type C = { size: number; line: boolean };
	let { config, editing }: BlockProps<C> = $props();
</script>

<div class="sp" class:line={config.line} class:editing style:height="{config.size}px" aria-hidden="true"></div>

<style>
	.sp {
		width: 100%;
	}
	.line {
		background: linear-gradient(var(--line), var(--line)) center / 100% 1px no-repeat;
	}
	.editing:not(.line) {
		background: repeating-linear-gradient(45deg, transparent 0 6px, var(--bg3) 6px 7px);
	}
</style>
