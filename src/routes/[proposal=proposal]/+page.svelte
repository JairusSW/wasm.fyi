<script lang="ts">
	import { PROPS } from '$lib/data/features';
	import Studio from '$lib/studio/Studio.svelte';

	let { data } = $props();
	const P = $derived(PROPS[data.id]);
</script>

<svelte:head>
	<title>{P.title} · wasm.fyi</title>
	<meta name="description" content="{P.long}: {P.q}" />
</svelte:head>

<Studio page="proposal" ctx={{ proposal: data.id }} />
