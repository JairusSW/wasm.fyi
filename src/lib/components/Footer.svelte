<script lang="ts">
	import { siteHref } from '$lib/links';
</script>

<footer>
	<div class="col">
		<span class="mono brand">wasm.fyi</span>
		<span class="fg3 s12">The reference for WebAssembly runtimes.</span>
		<span class="small warn">Preview — synthetic data.</span>
	</div>
	<div class="col">
		<span class="eyebrow">Data</span>
		<a href={siteHref(`/benchmarks`)}>Benchmarks</a>
		<a href={siteHref(`/history`)}>History</a>
		<a href={siteHref(`/features`)}>Features</a>
	</div>
	<div class="col">
		<span class="eyebrow">Proposals</span>
		<a href={siteHref(`/simd`)}>SIMD</a>
		<a href={siteHref(`/gc`)}>WasmGC</a>
		<a href={siteHref(`/memory64`)}>Memory64</a>
		<a href={siteHref(`/threads`)}>Threads</a>
	</div>
	<div class="col">
		<span class="eyebrow">Project</span>
		<span class="fg2">Methodology</span>
		<span class="fg2">Contribute</span>
		<a href="https://github.com/JairusSW/wasm.fyi">GitHub</a>
	</div>
</footer>

<style>
	footer {
		border-top: 1px solid var(--line);
		padding: 28px 20px 36px;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: 20px;
		font-size: 13px;
	}
	.col {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.brand {
		font-weight: 600;
		font-size: 14px;
	}
	.s12 {
		font-size: 12px;
	}
	.warn {
		color: var(--st-warn);
	}
	.eyebrow {
		font-size: 11px;
		color: var(--fg3);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	a {
		color: var(--fg2);
		text-decoration: none;
	}
	a:hover {
		color: var(--fg);
	}
</style>
