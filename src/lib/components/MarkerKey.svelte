<script lang="ts">
	/** Legend for history markers, drawn with the same shapes the charts use (HistoryMarker). */
	let { note = '' }: { note?: string } = $props();
</script>

<span class="marker-key">
	<span class="k"><i class="m diamond"></i>release</span>
	<span class="k"><i class="m circle"></i>commit</span>
	<span class="k"><i class="m diamond hollow"></i><i class="m circle hollow"></i>didn’t pass</span>
	{#if note}<span class="note">{note}</span>{/if}
</span>

<style>
	.marker-key {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 12px;
		font-size: 12px;
		color: var(--fg3);
	}
	.k {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.m {
		display: inline-block;
		flex: none;
		width: 8px;
		height: 8px;
		box-sizing: border-box;
		background: var(--fg2);
	}
	.diamond {
		width: 7px;
		height: 7px;
		transform: rotate(45deg);
		margin: 0 1px;
	}
	.circle {
		border-radius: 50%;
	}
	.hollow {
		background: transparent;
		border: 1.5px solid var(--fg2);
	}
</style>
