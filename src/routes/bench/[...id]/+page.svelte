<script lang="ts">
	import { workloadName } from '$lib/format';
	import Studio from '$lib/studio/Studio.svelte';

	let { data } = $props();
	const b = $derived(data.bench);
</script>

<svelte:head>
	<title>{workloadName(b.id)} · wasm.fyi</title>
	<meta name="description" content={b.purpose || `${workloadName(b.id)} — ${b.group} workload on wasm.fyi`} />
</svelte:head>

<Studio page="bench" ctx={{ bench: b }} />
