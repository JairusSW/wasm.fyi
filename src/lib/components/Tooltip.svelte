<script lang="ts">
	import { onMount } from 'svelte';

	// One delegated tooltip for the whole app: any element with `data-tip`
	// shows it on hover or keyboard focus. Hidden on scroll and click.
	let el: HTMLDivElement;
	let text = $state('');
	let shown = $state(false);
  type Summary={title:string;subtitle:string;rows:{label:string;pass:number;total:number;failed:number;skipped:number;missing:number;skippedLabel?:string}[];hint:string};
  let summary=$state<Summary|null>(null);

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
      const structured=target.getAttribute('data-tip-summary');
			if (!tip && !structured) return;
			cur = target;
            // Focus/scroll events can fire synchronously while Svelte removes
            // a view. Apply state after that render; discard superseded hovers.
            queueMicrotask(() => {
                if (cur !== target) return;
                text = tip || '';
                try { summary=structured?JSON.parse(structured):null; }catch{summary=null;}
                shown = true;
                requestAnimationFrame(() => place(x, y));
            });
		};
		const hide = () => {
			cur = null;
            queueMicrotask(() => { if (!cur) shown = false; });
		};
		const closest = (e: Event) => (e.target instanceof Element ? e.target.closest('[data-tip], [data-tip-summary]') : null);
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
		const key = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };
		document.addEventListener('keydown', key);
		document.addEventListener('mouseover', over);
		document.addEventListener('mousemove', move);
		document.addEventListener('focusin', focus);
		document.addEventListener('focusout', hide);
		document.addEventListener('scroll', hide, true);
		document.addEventListener('click', hide, true);
		return () => {
			document.removeEventListener('keydown', key);
			document.removeEventListener('mouseover', over);
			document.removeEventListener('mousemove', move);
			document.removeEventListener('focusin', focus);
			document.removeEventListener('focusout', hide);
			document.removeEventListener('scroll', hide, true);
			document.removeEventListener('click', hide, true);
		};
	});
</script>

<div bind:this={el} class="tip" role="tooltip" hidden={!shown}>
  {#if summary}
    <strong class="tip-title">{summary.title}</strong><div class="tip-sub">{summary.subtitle}</div>
    {#each summary.rows as row}
      <div class="tip-row"><span>{row.label}</span><strong class="mono">{row.pass}/{row.total}</strong></div>
      <div class="tip-bar"><span style:width={`${(row.total?row.pass/row.total*100:0)}%`} style:background="var(--st-pass)"></span><span style:width={`${(row.total?row.failed/row.total*100:0)}%`} style:background="var(--st-fail)"></span><span style:width={`${(row.total?row.skipped/row.total*100:0)}%`} style:background="var(--st-skip)"></span></div>
      <div class="tip-counts"><span>● {row.pass} passed</span>{#if row.failed}<span>✕ {row.failed} failed</span>{/if}{#if row.skipped}<span>— {row.skipped} {row.skippedLabel || 'unsupported'}</span>{/if}{#if row.missing}<span>? {row.missing} uncollected</span>{/if}</div>
    {/each}
    <div class="tip-hint">{summary.hint}</div>
  {:else}
    {@const lines=text.split('\n')}
    <strong class="tip-title">{lines[0]}</strong>
    {#each lines.slice(1).filter(Boolean) as line}<div class="tip-sub">{line}</div>{/each}
  {/if}
</div>

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
  .tip-title { display:block;font-size:12px; }
  .tip-sub { font-size:11px;color:var(--fg3);overflow-wrap:anywhere;margin-top:4px; }
  .tip-row { display:flex;justify-content:space-between;gap:20px;margin-top:10px;font-size:11px; }
  .tip-bar { display:flex;height:5px;background:var(--line2);margin:5px 0; }
  .tip-counts { display:flex;gap:10px;flex-wrap:wrap;font-size:10px;color:var(--fg2); }
  .tip-hint { border-top:1px solid var(--line);padding-top:6px;margin-top:10px;font-size:10px;color:var(--fg3); }
	.tip[hidden] {
		display: none;
	}
</style>
