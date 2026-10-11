<script lang="ts">
	import { page } from '$app/state';
	import { siteHref } from '$lib/links';

	const status = $derived(page.status);
	const missing = $derived(status === 404);
	const path = $derived(page.url.pathname);
</script>

<svelte:head>
	<title>{missing ? 'Not found' : `Error ${status}`} · wasm.fyi</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<section class="lost">
	{#snippet bench()}
		<!-- floor, with hatched shadow under the bench -->
		<path d="M10 240 H126 M134 240 H310" />
		<g class="hatch">
			{#each Array.from({ length: 24 }, (_, i) => 50 + i * 9.4) as x (x)}<path d="M{x} 246 l7 -6" />{/each}
		</g>
		<!-- park bench: posts and backrest planks behind, slatted seat, splayed legs -->
		<path d="M54 98 V150 M266 98 V150" />
		<path d="M34 102 h252 q4 0 4 4 v4 q0 4 -4 4 h-252 q-4 0 -4 -4 v-4 q0 -4 4 -4 z" class="wood" />
		<path d="M34 120 h252 q4 0 4 4 v4 q0 4 -4 4 h-252 q-4 0 -4 -4 v-4 q0 -4 4 -4 z" class="wood" />
		<path class="thin" d="M44 106.5 h30 M150 109 h40 M232 106 h24 M60 125 h26 M210 127 h36" />
		<path d="M50 146 H270 L284 156 H36 Z" class="wood" />
		<path class="thin" d="M43 151 H277" />
		<path d="M36 156 V162 H284 V156" class="wood" />
		<path d="M50 162 L42 239 M60 162 L68 239 M260 162 L252 239 M270 162 L278 239" />
		<path class="thin" d="M46 204 H64 M256 204 H274 M47 166 L65 200 M273 166 L255 200" />
		<!-- crumpled page on the seat -->
		<g class="thin">
			<path d="M236 148 q-7 -2 -6 -8 q2 -6 9 -5 q7 1 6 7 q-1 6 -9 6 z" class="paper" />
			<path d="M233 142 l4 2 l2 -4 l3 3 M234 146 l5 -2 l3 2" />
		</g>
	{/snippet}

	{#snippet figure()}
		<!-- legs dangling over the front edge, swinging -->
		<g class="leg leg-l"><path d="M142 156 q-1 13 0 25" /><path d="M141 181 q-8 -1 -9 3 q6 2 11 0" class="paper" /></g>
		<g class="leg leg-r"><path d="M178 156 q1 13 0 25" /><path d="M179 181 q8 -1 9 3 q-6 2 -11 0" class="paper" /></g>
		<g class="mascot">
			<!-- body: the WebAssembly mark, with hatching down its shaded side -->
			<path d="M112 56 H140 A20 20 0 0 0 180 56 H208 V154 H112 Z" class="paper" />
			<g class="hatch" clip-path="url(#body-clip)">
				{#each Array.from({ length: 16 }, (_, i) => 56 + i * 6.5) as y (y)}<path d="M196 {y + 8} l14 -12" />{/each}
			</g>
			<path class="thin" d="M115 60 V150" />
			<!-- arms resting on the seat -->
			<path d="M112 116 q-13 15 -10 36" />
			<path d="M208 116 q13 15 10 36" />
			<path class="thin" d="M99 152 q3 3 7 0 M214 152 q3 3 7 0" />
			<!-- face -->
			<path d="M127 99 q8 -1 15 -7 M193 99 q-8 -1 -15 -7" />
			<g class="eyes">
				<circle cx="137" cy="108" r="2.6" class="dot" />
				<circle cx="183" cy="108" r="2.6" class="dot" />
			</g>
			<path d="M150 127 q10 -7 20 0" />
			<path class="tear thin" d="M186 115 q-4 6.2 0 9.4 q4 -3.2 0 -9.4 z" />
		</g>
	{/snippet}

	<!-- Pen-and-ink sketch: the WebAssembly mark as a little character sitting on a park bench,
	     legs dangling, a bit sad. Each layer is inked twice: a solid pass and a faint, differently
	     wobbled overdraw, like a pen going back over its lines. The bench is inked a shade softer
	     so the figure reads as sitting on top of it. -->
	<svg class="scene" viewBox="0 0 320 250" role="img" aria-label="Ink sketch of the WebAssembly logo sitting sadly on a park bench">
		<defs>
			<filter id="ink" x="-5%" y="-5%" width="110%" height="110%">
				<feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="7" />
				<feDisplacementMap in="SourceGraphic" scale="2.6" />
			</filter>
			<filter id="ink-over" x="-5%" y="-5%" width="110%" height="110%">
				<feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="23" />
				<feDisplacementMap in="SourceGraphic" scale="3.4" />
			</filter>
			<clipPath id="body-clip"><path d="M112 56 H140 A20 20 0 0 0 180 56 H208 V154 H112 Z" /></clipPath>
		</defs>
		<g class="ink bench" filter="url(#ink)">{@render bench()}</g>
		<g class="ink bench over" filter="url(#ink-over)">{@render bench()}</g>
		<g class="ink" filter="url(#ink)">{@render figure()}</g>
		<g class="ink over" filter="url(#ink-over)">{@render figure()}</g>
	</svg>

	<div class="code mono" aria-hidden="true">{status}</div>
	<h1>{missing ? 'Nothing measured here' : 'Something went wrong'}</h1>
	<p class="fg3">
		{#if missing}
			<span class="mono path">{path}</span> isn’t a page we have. It may have moved, or never existed.
		{:else}
			{page.error?.message || 'An unexpected error occurred.'}
		{/if}
	</p>
	<nav class="actions" aria-label="Go somewhere else">
		<a class="btn-primary" href={siteHref('/benchmarks')}>Benchmarks</a>
		<a class="btn-outline" href={siteHref('/features')}>Features</a>
		<a class="btn-outline" href={siteHref('/history')}>History</a>
	</nav>
</section>

<style>
	.lost {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		padding: 48px 16px 72px;
		gap: 10px;
	}
	.scene {
		width: min(360px, 88vw);
		height: auto;
		overflow: visible;
	}
	.ink :global(path),
	.ink :global(circle) {
		fill: none;
		stroke: var(--fg);
		stroke-width: 1.6;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	/* Closed shapes are filled with the page colour so they hide the lines behind them. */
	.ink :global(.paper),
	.ink :global(.wood) {
		fill: var(--bg);
	}
	/* The bench is inked a shade softer than the figure, so the figure reads as on top of it. */
	.bench :global(path) {
		stroke: color-mix(in srgb, var(--fg) 78%, var(--bg));
	}
	/* The overdraw pass: lines only, faint and thin. */
	.over :global(path),
	.over :global(circle) {
		fill: none !important;
		stroke-width: 0.9;
		stroke-opacity: 0.4;
	}
	.over :global(.dot) {
		visibility: hidden;
	}
	.ink :global(.thin),
	.ink :global(.thin path) {
		stroke-width: 1;
	}
	.hatch :global(path) {
		stroke-width: 0.8;
		opacity: 0.75;
	}
	.ink :global(.dot) {
		fill: var(--fg);
		stroke: none;
	}
	.leg {
		transform-box: fill-box;
		transform-origin: 50% 0;
		animation: swing 2.6s ease-in-out infinite;
	}
	.leg-r {
		animation-delay: -1.3s;
	}
	.eyes {
		transform-box: fill-box;
		transform-origin: 50% 50%;
		animation: blink 5s infinite;
	}
	.tear {
		animation: tear 3.2s ease-in infinite;
	}
	.mascot {
		transform-box: fill-box;
		transform-origin: 50% 100%;
		animation: sigh 5.2s ease-in-out infinite;
	}
	@keyframes swing {
		0%, 100% { transform: rotate(9deg); }
		50% { transform: rotate(-9deg); }
	}
	@keyframes blink {
		0%, 92%, 100% { transform: scaleY(1); }
		95% { transform: scaleY(0.1); }
	}
	@keyframes tear {
		0%, 35% { transform: translateY(0); opacity: 0; }
		45% { opacity: 1; }
		90% { transform: translateY(26px); opacity: 0.9; }
		100% { transform: translateY(30px); opacity: 0; }
	}
	@keyframes sigh {
		0%, 100% { transform: scaleY(1); }
		50% { transform: scaleY(0.975); }
	}
	@media (prefers-reduced-motion: reduce) {
		.leg,
		.eyes,
		.tear,
		.mascot {
			animation: none;
		}
	}
	.code {
		font-size: 64px;
		line-height: 1;
		font-weight: 600;
		letter-spacing: 0.04em;
		color: var(--fg);
		margin-top: 4px;
	}
	h1 {
		font-size: 18px;
		font-weight: 600;
		margin: 2px 0 0;
	}
	p {
		max-width: 460px;
		margin: 0;
		font-size: 13px;
		line-height: 1.5;
	}
	.path {
		color: var(--fg2);
		word-break: break-all;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 8px;
		margin-top: 14px;
	}
</style>
