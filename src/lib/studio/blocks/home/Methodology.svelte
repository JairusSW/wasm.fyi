<script lang="ts">
	import type { BlockProps } from '../../types';
	import Heading from './Heading.svelte';

	type C = { eyebrow: string; title: string };
	let { config }: BlockProps<C> = $props();
</script>

<section class="col">
	<Heading eyebrow={config.eyebrow} title={config.title} />
	<div class="points">
		<div>
			<div class="w6 s14">Every number is reproducible</div>
			<div class="fg2">Each result resolves to a run record with versions, flags, machine, harness revision and the exact command.</div>
		</div>
		<div>
			<div class="w6 s14">Scope is always visible</div>
			<div class="fg2">Hardware, snapshot and workload set travel with every comparison, chart and export.</div>
		</div>
		<div>
			<div class="w6 s14">Missing is never zero</div>
			<div class="fg2">Unsupported, failed, crashed and not-measured stay distinct. Incorrect results get no performance credit.</div>
		</div>
	</div>
</section>

<style>
	.col {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 40px 0 12px;
	}
	.w6 {
		font-weight: 600;
	}
	.s14 {
		font-size: 14px;
	}
	.points {
		display: flex;
		flex-direction: column;
		gap: 14px;
		line-height: 1.5;
	}
</style>
