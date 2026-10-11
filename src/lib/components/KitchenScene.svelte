<script lang="ts">
	/**
	 * Pen-and-ink kitchen for the health page: the WebAssembly mark cooking breakfast.
	 * Healthy, it tosses an egg and the kitchen hums along; when something is wrong
	 * (`fire`), everything is on fire. Every layer is inked twice — a solid pass and a
	 * faint, differently wobbled overdraw — like the 404 page.
	 */
	import { onMount } from 'svelte';

	let { fire = false }: { fire?: boolean } = $props();

	// The wall clock shows the viewer's local time.
	let now = $state(new Date());
	onMount(() => {
		const id = setInterval(() => (now = new Date()), 1000);
		return () => clearInterval(id);
	});
	const sec = $derived(now.getSeconds() * 6);
	const min = $derived((now.getMinutes() + now.getSeconds() / 60) * 6);
	const hour = $derived(((now.getHours() % 12) + now.getMinutes() / 60) * 30);

	/** A curling flame tongue standing on (x, y), w wide and h tall: a left lobe, a hooked tip and a
	    right lick, like a hand-drawn flame. */
	const flame = (x: number, y: number, w: number, h: number) =>
		`M${x - w / 2} ${y} C${x - w * 0.62} ${y - h * 0.34} ${x - w * 0.12} ${y - h * 0.48} ${x - w * 0.26} ${y - h * 0.76} ` +
		`C${x - w * 0.04} ${y - h * 0.62} ${x + w * 0.04} ${y - h * 0.74} ${x - w * 0.02} ${y - h} ` +
		`C${x + w * 0.16} ${y - h * 0.8} ${x + w * 0.38} ${y - h * 0.62} ${x + w * 0.22} ${y - h * 0.42} ` +
		`C${x + w * 0.46} ${y - h * 0.5} ${x + w * 0.62} ${y - h * 0.24} ${x + w / 2} ${y} Z`;
	/** The flame's hotter core: a small teardrop low inside it. */
	const core = (x: number, y: number, w: number, h: number) =>
		`M${x - w * 0.2} ${y} C${x - w * 0.3} ${y - h * 0.2} ${x - w * 0.02} ${y - h * 0.3} ${x + w * 0.02} ${y - h * 0.46} ` +
		`C${x + w * 0.1} ${y - h * 0.28} ${x + w * 0.3} ${y - h * 0.18} ${x + w * 0.2} ${y} Z`;
	/** A puffy cloud centred on (x, y) with radius r. */
	const cloud = (x: number, y: number, r: number) =>
		`M${x - r} ${y + r * 0.35} q${-r * 0.5} ${-r * 0.55} ${r * 0.1} ${-r * 0.8} q${r * 0.2} ${-r * 0.75} ${r * 0.9} ${-r * 0.5} q${r * 0.5} ${-r * 0.55} ${r * 1.05} ${r * 0.05} q${r * 0.75} ${r * 0.05} ${r * 0.5} ${r * 0.85} q${-r * 0.2} ${r * 0.45} ${-r * 0.85} ${r * 0.4} q${-r * 0.5} ${r * 0.3} ${-r * 0.95} 0 z`;

	// Fire: flame clusters (each tongue flickers on its own clock), embers and smoke.
	const panFlames = [
		[276, 182, 30, 58],
		[262, 184, 18, 36],
		[292, 184, 20, 40],
		[276, 182, 14, 30],
		[256, 186, 10, 20],
		[300, 186, 11, 22]
	] as const;
	const potFlames = [
		[104, 156, 14, 26],
		[116, 154, 18, 34],
		[128, 156, 12, 22]
	] as const;
	const stoveFlames = [
		[74, 186, 12, 22],
		[86, 186, 9, 15],
		[66, 186, 8, 14]
	] as const;
	const embers = [
		[266, 150, 0],
		[280, 142, 0.6],
		[288, 156, 1.1],
		[272, 132, 1.6],
		[258, 160, 2.1],
		[296, 138, 0.3],
		[112, 132, 0.9],
		[120, 140, 1.8],
		[282, 120, 2.6],
		[250, 140, 1.4]
	] as const;
	const smoke = [
		[276, 108, 13, 0],
		[262, 92, 10, 1.2],
		[290, 84, 11, 2.4],
		[118, 116, 9, 0.6],
		[106, 98, 8, 1.8]
	] as const;
</script>

{#snippet room(fire: boolean)}
	<!-- floor and rug -->
	<path d="M8 258 H352" />
	<path d="M98 258 H262 L270 264 H90 Z" class="paper" />
	<path class="thin" d="M96 264 v3 M106 264 v3 M116 264 v3 M126 264 v3 M136 264 v3 M146 264 v3 M156 264 v3 M166 264 v3 M176 264 v3 M186 264 v3 M196 264 v3 M206 264 v3 M216 264 v3 M226 264 v3 M236 264 v3 M246 264 v3 M256 264 v3 M266 264 v3" />
	<!-- tiled backsplash behind the counter -->
	<g class="tiles">
		<path d="M58 150 H302 M58 162 H302 M58 174 H302" />
		{#each [70, 94, 118, 142, 166, 190, 214, 238, 262, 286] as x, i (x)}<path d="M{x + (i % 2) * 0} 150 v12 M{x + 12} 162 v12 M{x} 174 v12" />{/each}
	</g>
	<!-- shelf with jars and a plant -->
	<path d="M12 84 H92 M14 84 v6 l8 -6 M90 84 v6 l-8 -6" />
	<path d="M20 60 H40 V84 H20 Z" class="paper" />
	<path d="M18 55 H42 V60 H18 Z" class="paper" />
	<path class="thin" d="M23 68 H37 V76 H23 Z" />
	<path d="M47 66 Q47 62 51 62 H59 Q63 62 63 66 V84 H47 Z" class="paper" />
	<path class="thin" d="M50 62 V58 H60 V62 M51 72 h8" />
	<path d="M68 72 H86 L84 84 H70 Z" class="paper" />
	<g class="plant">
		<path d="M77 72 q-2 -12 -10 -16 q8 0 10 10 M77 72 q1 -14 8 -20 q-1 10 -6 18 M77 72 q4 -8 12 -8 q-4 6 -11 9" />
	</g>
	<!-- wall clock -->
	<circle cx="322" cy="40" r="17" class="paper" />
	<path class="thin" d="M322 25 v3 M337 40 h-3 M322 55 v-3 M307 40 h3" />
	<path d="M322 40 V32" transform="rotate({hour} 322 40)" />
	<path d="M322 40 V29" transform="rotate({min} 322 40)" />
	<path class="thin" d="M322 43 V27" transform="rotate({sec} 322 40)" />
	<circle cx="322" cy="40" r="1.6" class="dot" />
	<!-- utensil rail -->
	<path d="M296 98 H352" />
	<g class="hang h1" class:rattle={fire}>
		<path d="M306 98 v6 M306 104 V138" />
		<path d="M306 138 a7 7 0 1 0 0.1 0 z" class="paper" />
	</g>
	<g class="hang h2" class:rattle={fire}>
		<path d="M324 98 v6 M324 104 V124" />
		<path d="M324 124 q-9 10 0 30 q9 -20 0 -30 M324 124 q-4 12 0 30 q4 -18 0 -30" />
	</g>
	<g class="hang h3" class:rattle={fire}>
		<path d="M342 98 v6 M342 104 V130" />
		<path d="M336 130 H348 V150 H336 Z" class="paper" />
		<path class="thin" d="M339 134 v12 M342 134 v12 M345 134 v12" />
	</g>
	<!-- smoke detector on the ceiling -->
	<path d="M232 0 V4 H268 V0" class="paper" />
	<path d="M236 4 Q250 12 264 4" class="paper" />
	{#if fire}
		<circle cx="256" cy="7.5" r="1.8" class="led" />
		<g class="beep">
			<path class="thin" d="M272 6 q4 4 0 8 M277 3 q7 7 0 14" />
			<path class="thin" d="M228 6 q-4 4 0 8 M223 3 q-7 7 0 14" />
		</g>
	{:else}
		<circle cx="256" cy="7.5" r="1.4" class="dot" />
	{/if}
{/snippet}

{#snippet chef(fire: boolean)}
	<g class="chef" class:panic={fire}>
		<!-- body: the WebAssembly mark, behind the counter -->
		<path d="M140 88 H172 A18 18 0 0 0 208 88 H240 V188 H140 Z" class="paper" />
		<g class="hatch" clip-path="url(#k-body)">
			{#each Array.from({ length: 16 }, (_, i) => 88 + i * 6.5) as y (y)}<path d="M228 {y + 8} l14 -12" />{/each}
		</g>
		<path class="thin" d="M143 92 V184" />
		<!-- face: same proportions as the 404 guy (eyes just over halfway down) -->
			<g transform="translate(0 18)">
			{#if fire}
				<path d="M160 108 q8 -8 16 -3 M220 108 q-8 -8 -16 -3" />
				<circle cx="168" cy="122" r="7" class="paper" />
				<circle cx="212" cy="122" r="7" class="paper" />
				<g class="pupils"><circle cx="168" cy="122.5" r="2.2" class="dot" /><circle cx="212" cy="122.5" r="2.2" class="dot" /></g>
				<g class="scream"><ellipse cx="190" cy="134" rx="7" ry="5" class="paper" /><path class="thin" d="M185 135 q5 -3 10 0" /></g>
				<path class="thin sweat s1" d="M236 104 q-4 6.2 0 9.4 q4 -3.2 0 -9.4 z" />
				<path class="thin sweat s2" d="M144 110 q-4 6.2 0 9.4 q4 -3.2 0 -9.4 z" />
				<path class="thin sweat s3" d="M232 124 q-3 4.6 0 7 q3 -2.4 0 -7 z" />
			{:else}
				<path d="M160 112 q7 -4 14 0 M206 112 q7 -4 14 0" />
				<g class="eyes"><circle cx="168" cy="122" r="2.6" class="dot" /><circle cx="212" cy="122" r="2.6" class="dot" /></g>
				<path d="M178 132 q12 9 24 0" />
			{/if}
		</g>
	</g>
{/snippet}

{#snippet stove(fire: boolean)}
	<!-- counter and stove body -->
	<path d="M54 186 H306 V196 H54 Z" class="paper" />
	<path d="M62 196 H298 V258 H62 Z" class="paper" />
	{#each [86, 106, 126, 234, 254, 274] as x, i (x)}
		<circle cx={x} cy="206" r="4.5" class="paper" />
		<path class="thin" d="M{x} 206 l{i === 1 || i === 4 ? 3 : 0} {i === 1 || i === 4 ? -2.5 : -4}" />
	{/each}
	<!-- oven door, handle and window -->
	<path d="M80 216 H280 V254 H80 Z" class="paper" />
	<path d="M96 220 H264" />
	<path d="M112 226 H248 V250 H112 Z" class="paper" />
	<path class="thin" d="M118 230 l12 -2 M120 236 l18 -4" />
	<path class="thin" d="M140 246 H220" />
	{#if fire}
		<g clip-path="url(#k-window)">
			{#each [[140, 250, 16, 22], [160, 250, 22, 30], [182, 250, 18, 26], [204, 250, 22, 32], [226, 250, 14, 20]] as [x, y, w, h], i (i)}
				<g class="flame f{(i % 3) + 1}"><path d={flame(x, y, w, h)} /><path class="thin" d={core(x, y, w, h)} /></g>
			{/each}
		</g>
	{:else}
		<g class="loaf">
			<path d="M156 246 q2 -14 24 -14 q22 0 24 14 z" class="paper" />
			<path class="thin" d="M170 236 l4 4 M180 234 l4 4 M190 236 l4 4" />
		</g>
	{/if}
	<path d="M66 258 v2 M294 258 v2" />
{/snippet}

{#snippet front(fire: boolean)}
	<!-- pot on the back-left burner; its lid rattles -->
	<path d="M94 160 H130 V186 H94 Z" class="paper" />
	<path d="M94 166 h-6 v6 h6 M130 166 h6 v6 h-6" />
	<path class="thin" d="M98 176 h28" />
	{#if fire}
		{#each potFlames as [x, y, w, h], i (i)}<g class="flame f{(i % 3) + 1}"><path d={flame(x, y, w, h)} /><path class="thin" d={core(x, y, w, h)} /></g>{/each}
	{/if}
	<g class="lid" class:pop={fire}>
		<path d="M90 160 Q112 148 134 160 Z" class="paper" />
		<circle cx="112" cy="151" r="2.6" class="paper" />
	</g>
	{#if !fire}
		<g class="puffs">
			<path class="thin" d={cloud(92, 152, 4)} />
			<path class="thin" d={cloud(134, 150, 3.5)} />
		</g>
	{/if}

	<!-- spatula arm (flourishes; flails when it's all on fire) -->
	<g class="spatula" class:flail={fire}>
		<path class="limb" d="M141 150 q-14 -2 -20 -20" />
		<path d="M121 130 L108 98" />
		<path d="M100 82 L116 78 L118 94 L104 98 Z" class="paper" />
		<path class="thin" d="M106 84 l3 9 M111 83 l2 9" />
		<circle cx="121" cy="130" r="3.6" class="paper" />
	</g>

	<!-- the pan, its handle pointing back at the chef, tossed from his grip -->
	<g class="pan" class:still={fire}>
		<path d="M252 182 Q278 196 304 182 Z" class="paper" />
		<path d="M250 182 H306" />
		<path class="limb" d="M251 180 L246 175" />
		{#if !fire}
			<g class="egg">
				<path d="M264 180 q-4 -4 6 -5 q8 -3 14 0 q8 2 2 5 z" class="paper" />
				<circle cx="278" cy="177" r="3.2" class="paper" />
			</g>
		{:else}
			<!-- charred -->
			<path d="M266 180 q-2 -4 8 -5 q8 -2 12 1 q6 3 0 4 z" class="paper" />
			<path class="thin" d="M268 179 l4 -3 l3 3 l4 -3 l3 3 l3 -2" />
		{/if}
	</g>
	<!-- right arm out of his side, down to the handle -->
	<path class="limb" d="M240 146 q8 6 5 28" />
	<circle cx="245" cy="174" r="3.8" class="paper" />

	{#if fire}
		{#each [...panFlames, ...stoveFlames] as [x, y, w, h], i (i)}
			<g class="flame f{(i % 3) + 1}"><path d={flame(x, y, w, h)} /><path class="thin" d={core(x, y, w, h)} /></g>
		{/each}
		{#each embers as [x, y, d], i (i)}
			<circle cx={x} cy={y} r="1.2" class="ember" style:animation-delay="-{d}s" />
		{/each}
		{#each smoke as [x, y, r, d], i (i)}
			<path class="thin smoke" d={cloud(x, y, r)} style:animation-delay="-{d}s" />
		{/each}
	{:else}
		<g class="steam">
			{#each [266, 277, 288] as x, i (x)}
				<path class="thin" d="M{x} 168 q-4 -6 0 -12 q4 -6 0 -12 q-4 -6 0 -10" style:animation-delay="-{i * 0.9}s" />
			{/each}
		</g>
	{/if}
{/snippet}

<svg class="scene" viewBox="0 0 360 270" role="img" aria-label={fire ? 'Ink sketch of the WebAssembly logo in a kitchen where everything is on fire' : 'Ink sketch of the WebAssembly logo cooking breakfast, flipping an egg'}>
	<defs>
		<filter id="k-ink" x="-5%" y="-5%" width="110%" height="110%">
			<feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="7" />
			<feDisplacementMap in="SourceGraphic" scale="2.4" />
		</filter>
		<filter id="k-over" x="-5%" y="-5%" width="110%" height="110%">
			<feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="23" />
			<feDisplacementMap in="SourceGraphic" scale="3.2" />
		</filter>
		<clipPath id="k-body"><path d="M140 88 H172 A18 18 0 0 0 208 88 H240 V188 H140 Z" /></clipPath>
		<clipPath id="k-window"><path d="M112 226 H248 V250 H112 Z" /></clipPath>
	</defs>
	<!-- back to front: the room, the chef, the stove in front of him, then pots, pan, arms and effects -->
	<g class="ink soft" filter="url(#k-ink)">{@render room(fire)}</g>
	<g class="ink soft over" filter="url(#k-over)">{@render room(fire)}</g>
	<g class="ink" filter="url(#k-ink)">{@render chef(fire)}</g>
	<g class="ink over" filter="url(#k-over)">{@render chef(fire)}</g>
	<g class="ink soft" filter="url(#k-ink)">{@render stove(fire)}</g>
	<g class="ink soft over" filter="url(#k-over)">{@render stove(fire)}</g>
	<g class="ink" filter="url(#k-ink)">{@render front(fire)}</g>
	<g class="ink over" filter="url(#k-over)">{@render front(fire)}</g>
</svg>

<style>
	.scene {
		width: min(400px, 92vw);
		height: auto;
		overflow: visible;
	}
	/* ── pen ── */
	path,
	circle,
	ellipse {
		fill: none;
		stroke: var(--fg);
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.paper {
		fill: var(--bg);
	}
	.thin {
		stroke-width: 1;
	}
	.limb {
		stroke-width: 2.2;
	}
	.dot {
		fill: var(--fg);
		stroke: none;
	}
	.hatch path {
		stroke-width: 0.8;
		opacity: 0.75;
	}
	.soft path,
	.soft circle {
		stroke: color-mix(in srgb, var(--fg) 72%, var(--bg));
	}
	.tiles path {
		stroke-width: 0.7;
		opacity: 0.45;
	}
	.led {
		fill: var(--bad);
		stroke: none;
	}
	.flame path {
		fill: var(--bg);
		stroke-width: 1.3;
	}
	.flame path.thin {
		stroke-width: 0.9;
	}
	.ember {
		fill: var(--fg);
		stroke: none;
	}
	/* the overdraw pass: faint lines only */
	.over path,
	.over circle,
	.over ellipse {
		fill: none !important;
		stroke-width: 0.9;
		stroke-opacity: 0.4;
	}
	.over .dot,
	.over .led,
	.over .ember {
		visibility: hidden;
	}

	/* ── always: the kitchen is alive ── */
	.hang {
		transform-box: view-box;
		animation: sway 3.6s ease-in-out infinite alternate;
	}
	.h1 {
		transform-origin: 306px 98px;
	}
	.h2 {
		transform-origin: 324px 98px;
		animation-delay: -1.2s;
	}
	.h3 {
		transform-origin: 342px 98px;
		animation-delay: -2.4s;
	}
	.plant {
		transform-box: view-box;
		transform-origin: 77px 72px;
		animation: sway 4.2s ease-in-out infinite alternate;
	}
	.chef {
		animation: breathe 3.2s ease-in-out infinite;
	}
	.eyes {
		transform-box: fill-box;
		transform-origin: 50% 50%;
		animation: blink 4.6s infinite;
	}
	.loaf {
		transform-box: fill-box;
		transform-origin: 50% 100%;
		animation: rise 6s ease-in-out infinite;
	}

	/* ── healthy: the toss (3.2 s) — the pan kicks up from the grip, the egg arcs and flips ── */
	.pan {
		transform-box: view-box;
		transform-origin: 245px 174px;
		animation: toss 3.2s cubic-bezier(0.3, 0, 0.3, 1) infinite;
	}
	.egg {
		transform-box: fill-box;
		transform-origin: 50% 50%;
		animation: flip 3.2s cubic-bezier(0.25, 0, 0.35, 1) infinite;
	}
	.spatula {
		transform-box: view-box;
		transform-origin: 141px 150px;
		animation: flourish 3.2s ease-in-out infinite;
	}
	.steam path {
		animation: steam 3.2s ease-out infinite;
	}
	.lid {
		transform-box: view-box;
		transform-origin: 112px 160px;
		animation: rattle 3.2s ease-in-out infinite;
	}
	.puffs path {
		transform-box: fill-box;
		transform-origin: 50% 50%;
		animation: puff 3.2s ease-out infinite;
	}
	.puffs path:nth-child(2) {
		animation-delay: -0.4s;
	}

	/* ── on fire ── */
	.flame {
		transform-box: fill-box;
		transform-origin: 50% 100%;
		animation: flicker 0.46s ease-in-out infinite alternate;
	}
	.flame.f2 {
		animation-duration: 0.33s;
		animation-delay: -0.2s;
	}
	.flame.f3 {
		animation-duration: 0.57s;
		animation-delay: -0.1s;
	}
	.ember {
		animation: ember 2.8s linear infinite;
	}
	.smoke {
		transform-box: fill-box;
		transform-origin: 50% 50%;
		animation: smoke 3.6s ease-out infinite;
	}
	.beep {
		animation: beep 0.9s steps(2) infinite;
	}
	.led {
		animation: beep 0.9s steps(2) infinite;
	}
	.chef.panic {
		animation: shake 0.24s linear infinite;
	}
	.pupils {
		animation: dart 1.1s steps(1) infinite;
	}
	.scream {
		transform-box: fill-box;
		transform-origin: 50% 50%;
		animation: scream 0.4s ease-in-out infinite alternate;
	}
	.sweat {
		animation: fly 0.9s ease-in infinite;
	}
	.sweat.s2 {
		animation-name: fly-left;
		animation-delay: -0.3s;
	}
	.sweat.s3 {
		animation-delay: -0.6s;
	}
	.spatula.flail {
		animation: flail 0.32s ease-in-out infinite alternate;
	}
	.pan.still {
		animation: none;
	}
	.lid.pop {
		animation: pop 0.42s ease-in-out infinite;
	}
	.hang.rattle {
		animation-duration: 0.28s;
	}

	@keyframes sway {
		from { transform: rotate(-3deg); }
		to { transform: rotate(3deg); }
	}
	@keyframes breathe {
		0%, 100% { transform: translateY(0); }
		50% { transform: translateY(1.5px); }
	}
	@keyframes blink {
		0%, 93%, 100% { transform: scaleY(1); }
		96% { transform: scaleY(0.1); }
	}
	@keyframes rise {
		0%, 100% { transform: scaleY(0.9); }
		50% { transform: scaleY(1.06); }
	}
	@keyframes toss {
		0%, 8% { transform: rotate(0deg); }
		13% { transform: rotate(-13deg); }
		20% { transform: rotate(3deg); }
		26%, 44% { transform: rotate(0deg); }
		49% { transform: rotate(4deg); }
		55%, 100% { transform: rotate(0deg); }
	}
	/* the egg leaves the pan, flips over at the top of its arc and lands with a squash */
	@keyframes flip {
		0%, 11% { transform: translate(0, 0) scaleY(1) rotate(0deg); }
		18% { transform: translate(-2px, -30px) scaleY(0.5) rotate(-14deg); }
		25% { transform: translate(-4px, -50px) scaleY(-0.3) rotate(-18deg); }
		31% { transform: translate(-4px, -54px) scaleY(-1) rotate(-8deg); }
		38% { transform: translate(-3px, -38px) scaleY(-0.4) rotate(6deg); }
		44% { transform: translate(-1px, -12px) scaleY(0.6) rotate(4deg); }
		48% { transform: translate(0, 0) scaleY(1) rotate(0deg); }
		51% { transform: translate(0, 1px) scale(1.14, 0.8); }
		56% { transform: translate(0, 0) scale(0.96, 1.06); }
		62%, 100% { transform: translate(0, 0) scale(1, 1); }
	}
	@keyframes flourish {
		0%, 8% { transform: rotate(0deg); }
		16% { transform: rotate(12deg); }
		28% { transform: rotate(-6deg); }
		40%, 100% { transform: rotate(0deg); }
	}
	@keyframes steam {
		0%, 46% { transform: translateY(4px); opacity: 0; }
		60% { opacity: 0.9; }
		100% { transform: translateY(-18px); opacity: 0; }
	}
	@keyframes rattle {
		0%, 60%, 100% { transform: translateY(0) rotate(0deg); }
		64% { transform: translateY(-2px) rotate(-3deg); }
		68% { transform: translateY(0) rotate(2deg); }
		72% { transform: translateY(-2.5px) rotate(3deg); }
		76% { transform: translateY(0) rotate(0deg); }
	}
	@keyframes puff {
		0%, 62% { transform: translateY(0) scale(0.4); opacity: 0; }
		70% { opacity: 0.9; }
		100% { transform: translateY(-16px) scale(1.4); opacity: 0; }
	}
	@keyframes flicker {
		0% { transform: scale(1, 1) skewX(0deg); }
		35% { transform: scale(0.94, 1.1) skewX(-4deg); }
		70% { transform: scale(1.04, 0.93) skewX(3deg); }
		100% { transform: scale(0.97, 1.14) skewX(-2deg); }
	}
	@keyframes ember {
		0% { transform: translate(0, 0); opacity: 0; }
		10% { opacity: 1; }
		50% { transform: translate(5px, -40px); }
		100% { transform: translate(-3px, -84px); opacity: 0; }
	}
	@keyframes smoke {
		0% { transform: translate(0, 10px) scale(0.5); opacity: 0; }
		25% { opacity: 0.85; }
		100% { transform: translate(6px, -46px) scale(1.7); opacity: 0; }
	}
	@keyframes beep {
		0% { opacity: 1; }
		100% { opacity: 0.1; }
	}
	@keyframes shake {
		0%, 100% { transform: translate(0, 0); }
		25% { transform: translate(-1.4px, 0.6px); }
		50% { transform: translate(1.2px, -0.4px); }
		75% { transform: translate(-0.6px, -0.8px); }
	}
	@keyframes dart {
		0% { transform: translate(0, 0); }
		25% { transform: translate(-2px, 0.5px); }
		50% { transform: translate(2px, -0.5px); }
		75% { transform: translate(0.5px, 1.5px); }
	}
	@keyframes scream {
		from { transform: scale(1, 0.8); }
		to { transform: scale(1.1, 1.25); }
	}
	@keyframes fly {
		0% { transform: translate(0, 0); opacity: 1; }
		100% { transform: translate(10px, 14px); opacity: 0; }
	}
	@keyframes fly-left {
		0% { transform: translate(0, 0); opacity: 1; }
		100% { transform: translate(-10px, 14px); opacity: 0; }
	}
	@keyframes flail {
		from { transform: rotate(-22deg); }
		to { transform: rotate(14deg); }
	}
	@keyframes pop {
		0%, 100% { transform: translateY(0) rotate(0deg); }
		40% { transform: translateY(-9px) rotate(-8deg); }
		70% { transform: translateY(-3px) rotate(6deg); }
	}
	@media (prefers-reduced-motion: reduce) {
		* {
			animation: none !important;
		}
	}
</style>
