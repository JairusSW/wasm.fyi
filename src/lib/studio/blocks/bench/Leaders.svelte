<script lang="ts">
	import Leaders from '$lib/components/bench/Leaders.svelte';
	import { showMetric } from './scroll';
</script>

<Leaders onmetric={showMetric} />
