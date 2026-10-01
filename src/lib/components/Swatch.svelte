<script lang="ts">
	/** Runtime identity swatch: solid = primary backend, hollow = alternate backend. */
	let { color, bg, size = 8 }: { color: string; bg: string; size?: number } = $props();
</script>

<span class="sw" style:width="{size}px" style:height="{size}px" style:border-color={color} style:background={bg}></span>

<style>
	.sw {
		display: inline-block;
		flex: none;
		border: 1.5px solid;
		box-sizing: border-box;
	}
</style>
