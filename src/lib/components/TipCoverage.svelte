<script lang="ts">
	/** Partial-coverage meter: how much of the reference workload cohort was measured. */
	let { measured, reference }: { measured: number; reference: number } = $props();
</script>

<span class="cov">
	<span class="bar"><span style:width="{reference ? (measured / reference) * 100 : 0}%"></span></span>
	<span class="mono">{measured}/{reference}</span>
</span>

<style>
	.cov {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 10px;
		color: var(--st-warn);
		white-space: nowrap;
	}
	.bar {
		display: inline-block;
		width: 36px;
		height: 4px;
		background: var(--line2);
	}
	.bar span {
		display: block;
		height: 100%;
		background: var(--st-warn);
	}
</style>
