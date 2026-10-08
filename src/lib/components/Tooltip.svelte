<script lang="ts">
	import { onMount } from 'svelte';
	import { splitAction, type TipCard } from '$lib/tip';
	import Swatch from './Swatch.svelte';

	// One delegated tooltip for the whole app: any element with `data-tip`
	// (plain text), `data-tip-card` (TipCard JSON) or `data-tip-summary`
	// (feature pass-rate JSON) shows it on hover or keyboard focus.
	// Hidden on scroll and click.
	let el: HTMLDivElement;
	let shown = $state(false);
	type Summary = { title: string; subtitle: string; rows: { label: string; pass: number; total: number; failed: number; skipped: number; missing: number; skippedLabel?: string }[]; hint: string };
	let summary = $state<Summary | null>(null);
	let card = $state<TipCard | null>(null);

	const parse = <T,>(json: string | null): T | null => {
		if (!json) return null;
		try {
			return JSON.parse(json);
		} catch {
			return null;
		}
	};
	/** Plain text becomes a minimal card: first line title, rest as lines, trailing "Click …" as the action. */
	const fromText = (text: string): TipCard => {
		const { lines, action } = splitAction(text.split('\n').filter(Boolean));
		return { title: lines[0], note: lines.slice(1).join('\n'), action };
	};
	const pct = (n: number, total: number) => `${total ? (n / total) * 100 : 0}%`;

	onMount(() => {
		let cur: Element | null = null;
 let hideTimer:ReturnType<typeof setTimeout>|undefined;
		const place = (x: number, y: number) => {
			const r = el.getBoundingClientRect();
			let L = x + 14;
			let T = y + 16;
			// Prefer below-right of the cursor, flip when that overflows, then
			// clamp so the whole box stays inside the viewport either way.
			if (L + r.width > innerWidth - 8) L = x - r.width - 14;
			if (T + r.height > innerHeight - 8) T = y - r.height - 12;
			el.style.left = Math.max(8, Math.min(L, innerWidth - r.width - 8)) + 'px';
			el.style.top = Math.max(8, Math.min(T, innerHeight - r.height - 8)) + 'px';
		};
		const show = (target: Element, x: number, y: number) => {
 clearTimeout(hideTimer);
			const tip = target.getAttribute('data-tip');
			const structured = target.getAttribute('data-tip-summary');
			const cardJson = target.getAttribute('data-tip-card');
			if (!tip && !structured && !cardJson) return;
			cur = target;
			// Focus/scroll events can fire synchronously while Svelte removes
			// a view. Apply state after that render; discard superseded hovers.
			queueMicrotask(() => {
				if (cur !== target) return;
				summary = parse<Summary>(structured);
				card = summary ? null : (parse<TipCard>(cardJson) ?? (tip ? fromText(tip) : null));
				shown = !!(summary || card);
				requestAnimationFrame(() => place(x, y));
			});
		};
  const hide = () => {clearTimeout(hideTimer);hideTimer=setTimeout(()=>{cur=null;shown=false},180)};
		const closest = (e: Event) => (e.target instanceof Element ? e.target.closest('[data-tip], [data-tip-card], [data-tip-summary]') : null);
		// Touch has no hover: ignore the compatibility mouse events a tap emits, and let a tap
		// on a non-interactive element toggle its tip instead.
		let touchAt = 0;
		const recentTouch = () => performance.now() - touchAt < 800;
		const pointer = (e: PointerEvent) => {
			if (e.pointerType !== 'mouse') touchAt = performance.now();
		};
		const tap = (e: MouseEvent) => {
			if (!recentTouch()) return hide();
			const t = closest(e);
			const interactive = t && (e.target as Element).closest('a, button, input, select, label, summary, [role="button"], [onclick]');
			if (!t || interactive || t === cur) return hide();
			const r = t.getBoundingClientRect();
			show(t, Math.min(r.left, innerWidth - 24), r.bottom - 8);
		};
		const over = (e: MouseEvent) => {
 if(el.contains(e.target as Node)){clearTimeout(hideTimer);return;}
			if (recentTouch()) return;
			const t = closest(e);
			if(t===cur)clearTimeout(hideTimer);
			if (t && t !== cur) show(t, e.clientX, e.clientY);
			else if (!t && cur) hide();
		};
		const move = (e: MouseEvent) => {
 if(el.contains(e.target as Node))return;
			if (cur && closest(e)===cur && !recentTouch()) place(e.clientX, e.clientY);
		};
		const focus = (e: FocusEvent) => {
 if(el.contains(e.target as Node)){clearTimeout(hideTimer);return;}
			const t = closest(e);
			if (t && (e.target as Element).matches(':focus-visible')) {
				const r = t.getBoundingClientRect();
				show(t, r.left, r.bottom);
			}
		};
		const key = (e: KeyboardEvent) => {
			if (e.key === 'Escape') hide();
		};
		document.addEventListener('keydown', key);
		document.addEventListener('mouseover', over);
		document.addEventListener('mousemove', move);
		document.addEventListener('focusin', focus);
		document.addEventListener('focusout', hide);
		document.addEventListener('scroll', hide, true);
		document.addEventListener('click', tap, true);
		document.addEventListener('pointerdown', pointer, true);
		return () => {
 clearTimeout(hideTimer);
			document.removeEventListener('keydown', key);
			document.removeEventListener('mouseover', over);
			document.removeEventListener('mousemove', move);
			document.removeEventListener('focusin', focus);
			document.removeEventListener('focusout', hide);
			document.removeEventListener('scroll', hide, true);
			document.removeEventListener('click', tap, true);
			document.removeEventListener('pointerdown', pointer, true);
		};
	});
</script>

{#snippet action(text: string)}
	<div class="tip-act"><span class="kbd">click</span><span>{text}</span></div>
{/snippet}

<div bind:this={el} class="tip" style:pointer-events={card?.who?.url?'auto':'none'} role="tooltip" hidden={!shown}>
	{#if summary}
		{@const hint = splitAction(['', summary.hint])}
		<strong class="tip-title">{summary.title}</strong>
		<div class="tip-note">{summary.subtitle}</div>
		{#each summary.rows as row}
			<div class="tip-row"><span>{row.label}</span><strong class="mono">{row.pass}/{row.total}</strong></div>
			<div class="tip-bar">
				<span style:width={pct(row.pass, row.total)} style:background="var(--st-pass)"></span>
				<span style:width={pct(row.failed, row.total)} style:background="var(--st-fail)"></span>
				<span style:width={pct(row.skipped, row.total)} style:background="var(--st-skip)"></span>
			</div>
			<div class="tip-counts">
				<span><i style:background="var(--st-pass)"></i>{row.pass} passed</span>
				{#if row.failed}<span><i style:background="var(--st-fail)"></i>{row.failed} failed</span>{/if}
				{#if row.skipped}<span><i style:background="var(--st-skip)"></i>{row.skipped} {row.skippedLabel || 'unsupported'}</span>{/if}
				{#if row.missing}<span><i class="hollow"></i>{row.missing} uncollected</span>{/if}
			</div>
		{/each}
		{#if hint.action}{@render action(hint.action)}{:else}<div class="tip-fine">{summary.hint}</div>{/if}
	{:else if card}
		{#if card.kicker}<div class="tip-kicker">{card.kicker}</div>{/if}
		{#if card.title}<strong class="tip-title">{card.title}</strong>{/if}
		{#if card.who}
			<div class="tip-who">
				<Swatch color={card.who.col} bg={card.who.hollow ? 'transparent' : card.who.col} />
				<strong>{card.who.rt}</strong>
				<span class="mono fg3">{card.who.be}</span>
				{#if card.who.ver}<span class="chip mono">{#if card.who.url}<a href={card.who.url} target="_blank" rel="noopener noreferrer">{card.who.ver}</a>{:else}{card.who.ver}{/if}</span>{/if}
			</div>
		{/if}
		{#if card.value}
			<div class="tip-value">
				{#if card.heat}<span class="heat" style:background={card.heat}></span>{/if}
				<span class="mono big" style:color={card.valueColor}>{card.value}</span>
				{#if card.sub}<span class="mono fg3">{card.sub}</span>{/if}
			</div>
		{/if}
		{#if card.stats}
			<dl class="tip-stats">
				{#each card.stats as [k, v]}<dt>{k}</dt><dd class="mono">{v}</dd>{/each}
			</dl>
		{/if}
		{#if card.chips}
			<div class="tip-chips">{#each card.chips as c}<span class="chip">{c}</span>{/each}</div>
		{/if}
		{#if card.points}
			<ul class="tip-points">{#each card.points as p}<li>{p}</li>{/each}</ul>
		{/if}
		{#if card.note}<div class="tip-note">{card.note}</div>{/if}
		{#if card.action}{@render action(card.action)}{/if}
	{/if}
</div>

<style>
	.tip {
		position: fixed;
		z-index: 9999;
		pointer-events: none;
		display: flex;
		flex-direction: column;
		gap: 5px;
		min-width: min(160px, calc(100vw - 16px));
		max-width: min(320px, calc(100vw - 16px));
		max-height: calc(100vh - 16px);
		overflow: hidden;
		overflow-wrap: anywhere;
		padding: 8px 10px;
		box-sizing: border-box;
		font: 12px/1.45 var(--sans);
		background: var(--bg);
		color: var(--fg);
		border: 1px solid var(--line2);
		box-shadow: var(--shadow-float);
	}
	.tip-kicker {
		font: 10px/1.2 var(--mono);
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--fg3);
	}
	.tip-title {
		display: block;
		font-size: 12px;
	}
	.tip-who {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
	}
	.tip-who .fg3 {
		font-size: 11px;
	}
	.tip-value {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 11px;
	}
	.big {
		font-size: 16px;
		line-height: 1.2;
	}
	.heat {
		width: 12px;
		height: 12px;
		border: 1px solid var(--line2);
		flex: none;
	}
	.tip-stats {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 2px 12px;
		margin: 0;
		font-size: 11px;
	}
	.tip-stats dt {
		color: var(--fg3);
	}
	.tip-stats dd {
		margin: 0;
		text-align: right;
	}
	.tip-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.chip {
		padding: 0 5px;
		font-size: 10px;
		line-height: 16px;
		color: var(--fg2);
		background: var(--bg3);
		border: 1px solid var(--line);
		border-radius: 3px;
	}
	.tip-points {
		margin: 0;
		padding-left: 14px;
		font-size: 11px;
		color: var(--fg2);
	}
	.tip-points li + li {
		margin-top: 2px;
	}
	.tip-note {
		white-space: pre-line;
		font-size: 11px;
		color: var(--fg3);
	}
	.tip-fine {
		font-size: 10px;
		color: var(--fg3);
	}
	.tip-act {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		color: var(--fg2);
		border-top: 1px solid var(--line);
		padding-top: 6px;
		margin-top: 1px;
	}
	.tip-act:first-child {
		border-top: 0;
		padding-top: 0;
		margin-top: 0;
	}
	.kbd {
		font: 9px/14px var(--mono);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 0 4px;
		color: var(--fg3);
		border: 1px solid var(--line2);
		border-radius: 3px;
	}
	.tip-row {
		display: flex;
		justify-content: space-between;
		gap: 20px;
		margin-top: 5px;
		font-size: 11px;
	}
	.tip-bar {
		display: flex;
		height: 5px;
		background: var(--line2);
	}
	.tip-counts {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
		font-size: 10px;
		color: var(--fg2);
	}
	.tip-counts i {
		display: inline-block;
		width: 6px;
		height: 6px;
		margin-right: 4px;
	}
	.tip-counts i.hollow {
		border: 1px solid var(--fg3);
		box-sizing: border-box;
	}
	.tip[hidden] {
		display: none;
	}
</style>
