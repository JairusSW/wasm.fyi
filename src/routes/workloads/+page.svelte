<script lang="ts">
	import { base } from '$app/paths';
	let { data } = $props();
</script>

<svelte:head><title>Prepared workload catalog · wasm.fyi</title></svelte:head>

<article class="catalog">
	<header>
		<span class="eyebrow">Prepared workload catalog</span>
		<h1>What each workload does</h1>
		<p class="lead">{data.count} prepared contracts across {data.categories.length} use-case categories, with purpose, work units, reset policy and artifact provenance.</p>
		<p>{data.policy} A prepared artifact does not establish that a runtime supports it or that a measurement exists.</p>
		<p>These pages are readable without JavaScript. For platform-specific results, use <a href={base + '/benchmarks/'}>interactive benchmarks</a> or the <a href={base + '/docs/'}>API and measurement guide</a>. <a href={data.source}>Read the committed source catalog</a>.</p>
	</header>
	<nav aria-label="Workload categories">
		{#each data.categories as category (category.name)}
			<a href={'#' + category.anchor}>{category.name} <span class="fg3">({category.workloads.length})</span></a>
		{/each}
	</nav>
	{#each data.categories as category (category.name)}
		<section id={category.anchor} aria-labelledby={category.anchor + '-heading'}>
			<h2 id={category.anchor + '-heading'}>{category.name}</h2>
			<ul>
				{#each category.workloads as workload (workload.id)}
					<li>
						<h3><a class="mono" href={base + workload.path}>{workload.name}</a></h3>
						<p>{workload.description}</p>
					</li>
				{/each}
			</ul>
		</section>
	{/each}
</article>

<style>
	.catalog { max-width:1100px;display:flex;flex-direction:column;gap:28px;line-height:1.6; }
	h1 { font-size:clamp(26px,4vw,40px);line-height:1.15;letter-spacing:-.025em;margin:12px 0; }
	.lead { font-size:18px; }
	p { color:var(--fg2);margin:8px 0; }
	nav { display:flex;flex-wrap:wrap;gap:10px 22px;border-block:1px solid var(--line);padding:16px 0; }
	h2 { font-size:20px;margin:0 0 12px; }
	ul { display:grid;grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr));gap:12px;list-style:none;padding:0;margin:0; }
	li { border:1px solid var(--line2);padding:12px 16px;min-width:0; }
	h3 { font-size:13px;overflow-wrap:anywhere;margin:0 0 6px; }
	li p { margin:0;font-size:13px; }
</style>
