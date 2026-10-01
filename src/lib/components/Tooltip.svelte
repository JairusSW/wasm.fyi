<script lang="ts">
	import { onMount } from 'svelte';

	// One delegated tooltip for the whole app: any element with `data-tip`
	// shows it on hover or keyboard focus. Hidden on scroll and click.
	let el: HTMLDivElement;
	let text = $state('');
	let shown = $state(false);

	onMount(() => {
		let cur: Element | null = null;
		const place = (x: number, y: number) => {
			const r = el.getBoundingClientRect();
			let L = x + 14;
			let T = y + 16;
			if (L + r.width > innerWidth - 8) L = x - r.width - 14;
			if (T + r.height > innerHeight - 8) T = y - r.height - 12;
			el.style.left = Math.max(8, L) + 'px';
			el.style.top = Math.max(8, T) + 'px';
		};
		const show = (target: Element, x: number, y: number) => {
			const tip = target.getAttribute('data-tip');
			if (!tip) return;
			cur = target;
			text = tip;
			shown = true;
			// Measure after the new text renders.
			requestAnimationFrame(() => place(x, y));
		};
		const hide = () => {
			cur = null;
			shown = false;
		};
		const closest = (e: Event) => (e.target instanceof Element ? e.target.closest('[data-tip]') : null);
		const over = (e: MouseEvent) => {
			const t = closest(e);
			if (t && t !== cur) show(t, e.clientX, e.clientY);
			else if (!t && cur) hide();
		};
		const move = (e: MouseEvent) => {
			if (cur) place(e.clientX, e.clientY);
		};
		const focus = (e: FocusEvent) => {
			const t = closest(e);
			if (t && (e.target as Element).matches(':focus-visible')) {
				const r = t.getBoundingClientRect();
				show(t, r.left, r.bottom);
			}
		};
		document.addEventListener('mouseover', over);
		document.addEventListener('mousemove', move);
		document.addEventListener('focusin', focus);
		document.addEventListener('focusout', hide);
		document.addEventListener('scroll', hide, true);
		document.addEventListener('click', hide, true);
		return () => {
			document.removeEventListener('mouseover', over);
			document.removeEventListener('mousemove', move);
			document.removeEventListener('focusin', focus);
			document.removeEventListener('focusout', hide);
			document.removeEventListener('scroll', hide, true);
			document.removeEventListener('click', hide, true);
		};
	});
</script>

<div bind:this={el} class="tip" role="tooltip" hidden={!shown}>{text}</div>

<style>
	.tip {
		position: fixed;
		z-index: 9999;
		pointer-events: none;
		max-width: 320px;
		padding: 6px 9px;
		font: 12px/1.45 var(--sans);
		white-space: pre-line;
		background: var(--bg);
		color: var(--fg);
		border: 1px solid var(--line2);
		box-shadow: var(--shadow-float);
	}
	.tip[hidden] {
		display: none;
	}
</style>
