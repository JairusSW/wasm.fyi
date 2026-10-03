<script lang="ts">
	import Matrix from '$lib/components/bench/Matrix.svelte';
	import { showMetric } from './scroll';
</script>

<Matrix onmetric={showMetric} />
