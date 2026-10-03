import { tick } from 'svelte';
import type { MetricKey } from '$lib/data/types';
import { ui } from '$lib/state.svelte';

/** Switch the per-workload matrix to a metric and bring it into view, if it is on the page. */
export async function showMetric(m: MetricKey) {
	ui.metric = m;
	await tick();
	document.getElementById('workloads')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
