<script lang="ts">
	import Swatch from '$lib/components/Swatch.svelte';
	import { CFG } from '$lib/data/runtimes';
	import { isVisible } from '$lib/model';
	import { ui } from '$lib/state.svelte';
	import { BLOCKS } from './registry';
	import { studio } from './store.svelte';
	import type { BlockConfig, Field, FieldOption } from './types';

	const page = $derived(studio.current);
	const block = $derived(studio.selected ? studio.layout(page).blocks.find((b) => b.id === studio.selected) : undefined);
	const def = $derived(block ? BLOCKS[block.type] : undefined);
	const open = $derived(!!(studio.editing && block && def));

	$effect(() => {
		document.documentElement.classList.toggle('studio-panel', open);
		return () => document.documentElement.classList.remove('studio-panel');
	});
	$effect(() => {
		if (!studio.editing) studio.selected = null;
	});

	const visible = $derived((def?.fields ?? []).filter((f) => !f.when || f.when(block!.config as never)));
	const sections = $derived([...new Set(visible.map((f) => f.section ?? ''))]);
	const opts = (f: Field, c: BlockConfig): FieldOption[] => (typeof f.options === 'function' ? f.options(c as never) : (f.options ?? []));
	const err = (f: Field, c: BlockConfig) => f.validate?.(c[f.key], c as never) ?? null;

	function set(key: string, value: unknown, record = true) {
		if (!block) return;
		const patch: BlockConfig = { [key]: value };
		// Keep the chart type valid when its data source changes.
		if (key === 'source' && def?.fields) {
			const kindField = def.fields.find((f) => f.key === 'kind');
			const kinds = kindField ? opts(kindField, { ...block.config, source: value }).map(([v]) => v) : [];
			if (kinds.length && !kinds.includes(String(block.config.kind))) patch.kind = kinds[0];
		}
		studio.update(page, block.id, patch, record);
	}
	// Text inputs: one undo step per focus session rather than per keystroke.
	const focusIn = () => studio.beginGesture(page);
	const focusOut = () => studio.endGesture();

	function toggleIn(key: string, value: string) {
		const cur = (block?.config[key] as string[]) ?? [];
		set(key, cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value]);
	}

	const SPANS: [number, string][] = [
		[3, '¼'],
		[4, '⅓'],
		[6, '½'],
		[8, '⅔'],
		[9, '¾'],
		[12, 'Full']
	];
	const targets = $derived([
		...studio.dashboards.map((d) => ['dash:' + d.id, d.name] as [string, string]),
		...(['home', 'benchmarks', 'history', 'features'] as const).map((p) => [p, studio.pageName(p)] as [string, string])
	].filter(([k]) => k !== page));
	let copyTarget = $state('');

	function resetBlock() {
		if (block && def) studio.update(page, block.id, def.defaults());
	}
</script>

{#if open && block && def}
	<aside class="panel-settings" aria-label="Block settings">
		<div class="top">
			<div class="titles">
				<div class="kicker">{def.category} · settings</div>
				<div class="name">{def.label}</div>
			</div>
			<button class="x" onclick={() => (studio.selected = null)} aria-label="Close settings">Esc</button>
		</div>
		<div class="body">
			<div class="sec">
				<div class="sec-title">Layout</div>
				<div class="field">
					<span class="lab">Width</span>
					<div class="seg">
						{#each SPANS as [n, label] (n)}
							<button aria-pressed={block.span === n} disabled={n < (def.minSpan ?? 1)} onclick={() => studio.setSpan(page, block.id, n)}>{label}</button>
						{/each}
					</div>
				</div>
				<label class="toggle"><input type="checkbox" checked={!!block.collapsed} onchange={(e) => studio.setCollapsed(page, block.id, e.currentTarget.checked)} /> Collapsed to its title</label>
				{#if block.height}
					<div class="inline small fg2">Height limited to {block.height}px <button class="mini" onclick={() => studio.setHeight(page, block.id, null)}>Full height</button></div>
				{/if}
			</div>

			{#each sections as sec (sec)}
				<div class="sec">
					{#if sec}<div class="sec-title">{sec}</div>{/if}
					{#each visible.filter((f) => (f.section ?? '') === sec) as f (f.key)}
						{@const v = block.config[f.key]}
						{@const e = err(f, block.config)}
						<div class="field">
							{#if f.type === 'toggle'}
								<label class="toggle"><input type="checkbox" checked={!!v} onchange={(ev) => set(f.key, ev.currentTarget.checked)} /> {f.label}</label>
							{:else}
								<label class="lab" for="f-{f.key}">{f.label}</label>
								{#if f.type === 'text'}
									<input id="f-{f.key}" type="text" value={String(v ?? '')} placeholder={f.placeholder} onfocus={focusIn} onblur={focusOut} oninput={(ev) => set(f.key, ev.currentTarget.value, false)} />
								{:else if f.type === 'textarea'}
									<textarea id="f-{f.key}" rows="6" value={String(v ?? '')} onfocus={focusIn} onblur={focusOut} oninput={(ev) => set(f.key, ev.currentTarget.value, false)}></textarea>
								{:else if f.type === 'expr'}
									<textarea id="f-{f.key}" class="mono expr" class:bad={!!e} rows="2" spellcheck="false" value={String(v ?? '')} onfocus={focusIn} onblur={focusOut} oninput={(ev) => set(f.key, ev.currentTarget.value, false)}></textarea>
								{:else if f.type === 'select'}
									<select id="f-{f.key}" value={String(v ?? '')} onchange={(ev) => set(f.key, ev.currentTarget.value)}>
										{#each opts(f, block.config) as [ov, ol] (ov)}<option value={ov}>{ol}</option>{/each}
									</select>
								{:else if f.type === 'number'}
									<input id="f-{f.key}" type="number" min={f.min} max={f.max} step={f.step ?? 1} value={Number(v ?? 0)} onchange={(ev) => set(f.key, Math.max(f.min ?? -Infinity, Math.min(f.max ?? Infinity, Number(ev.currentTarget.value) || 0)))} />
								{:else if f.type === 'range'}
									<div class="range">
										<input id="f-{f.key}" type="range" min={f.min} max={f.max} step={f.step ?? 1} value={Number(v ?? 0)} onpointerdown={focusIn} onpointerup={focusOut} oninput={(ev) => set(f.key, Number(ev.currentTarget.value), false)} />
										<span class="mono small">{v}</span>
									</div>
								{:else if f.type === 'chips'}
									<div class="chips" id="f-{f.key}">
										{#each opts(f, block.config) as [ov, ol] (ov)}
											<button class="chip" aria-pressed={((v as string[]) ?? []).includes(ov)} onclick={() => toggleIn(f.key, ov)}>{ol}</button>
										{/each}
									</div>
								{:else if f.type === 'configs'}
									{@const sel = (v as string[]) ?? []}
									<div class="chips" id="f-{f.key}">
										{#each CFG.filter((c) => isVisible({ ...ui.scope, hide: {} }, c)) as c (c.id)}
											<button class="chip" aria-pressed={sel.includes(c.id)} onclick={() => toggleIn(f.key, c.id)} data-tip="{c.rt} {c.ver} · {c.be}">
												<Swatch color={c.col} bg={c.hollow ? 'transparent' : c.col} />{c.rt} <span class="fg3 micro">{c.be}</span>
											</button>
										{/each}
									</div>
									<div class="row-btns">
										<button class="mini" onclick={() => set(f.key, [])}>Follow scope bar</button>
										<button class="mini" onclick={() => set(f.key, CFG.filter((c) => isVisible(ui.scope, c)).map((c) => c.id))}>Pin current selection</button>
									</div>
								{/if}
							{/if}
							{#if e}<div class="error">{e}</div>{/if}
							{#if f.help}<div class="help">{f.help}</div>{/if}
						</div>
					{/each}
				</div>
			{/each}

			<div class="sec">
				<div class="sec-title">Block</div>
				{#if !def.requires}
					<div class="field">
						<label class="lab" for="copy-to">Copy to another page</label>
						<div class="inline">
							<select id="copy-to" bind:value={copyTarget}>
								<option value="">Choose…</option>
								{#each targets as [k, n] (k)}<option value={k}>{n}</option>{/each}
							</select>
							<button class="mini" disabled={!copyTarget} onclick={() => { studio.copyTo(page, block.id, copyTarget); copyTarget = ''; }}>Copy</button>
						</div>
					</div>
				{/if}
				<div class="row-btns">
					<button class="mini" onclick={() => studio.duplicate(page, block.id)} disabled={def.unique}>Duplicate</button>
					{#if def.fields?.length}<button class="mini" onclick={resetBlock}>Reset settings</button>{/if}
					<button class="mini danger" onclick={() => studio.remove(page, block.id)}>Remove</button>
				</div>
			</div>
		</div>
	</aside>
{/if}

<svelte:window onkeydown={(e) => open && e.key === 'Escape' && !(e.target as HTMLElement).closest('input,textarea,select') && (studio.selected = null)} />

<style>
	:global(html.studio-panel main) {
		margin-right: 380px;
	}
	@media (max-width: 900px) {
		:global(html.studio-panel main) {
			margin-right: 0;
		}
	}
	.panel-settings {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		width: 380px;
		max-width: 100vw;
		background: var(--bg2);
		border-left: 1px solid var(--line2);
		box-shadow: -12px 0 32px rgba(0, 0, 0, 0.28);
		overflow: auto;
		z-index: 60;
	}
	.top {
		position: sticky;
		top: 0;
		z-index: 1;
		background: var(--bg2);
		border-bottom: 1px solid var(--line);
		padding: 12px 16px;
		display: flex;
		gap: 10px;
		align-items: flex-start;
	}
	.titles {
		flex: 1;
	}
	.name {
		font-size: 14px;
		font-weight: 600;
	}
	.x {
		border: 1px solid var(--line2);
		padding: 2px 8px;
		color: var(--fg2);
	}
	.body {
		padding: 6px 16px 24px;
	}
	.sec {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 12px 0;
		border-bottom: 1px solid var(--line);
	}
	.sec-title {
		font-size: 11px;
		color: var(--fg3);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.lab {
		font-size: 12px;
		color: var(--fg2);
	}
	input[type='text'],
	input[type='number'],
	textarea,
	select {
		background: var(--bg);
		border: 1px solid var(--line2);
		border-radius: 0;
		padding: 5px 8px;
		font-size: 12px;
		width: 100%;
		box-sizing: border-box;
	}
	textarea {
		resize: vertical;
		font-family: inherit;
		line-height: 1.45;
	}
	.expr {
		font-family: var(--mono);
	}
	.bad {
		border-color: var(--st-fail);
	}
	.error {
		font-size: 11px;
		color: var(--st-fail);
	}
	.help {
		font-size: 11px;
		color: var(--fg3);
		line-height: 1.4;
	}
	.toggle {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: var(--fg2);
		cursor: pointer;
	}
	.range {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.range input {
		flex: 1;
		accent-color: var(--fg2);
	}
	.seg {
		display: inline-flex;
		border: 1px solid var(--line2);
		flex-wrap: wrap;
	}
	.seg button {
		padding: 3px 10px;
		font-size: 12px;
		color: var(--fg2);
	}
	.seg button[aria-pressed='true'] {
		background: var(--line2);
		color: var(--fg);
	}
	.seg button:disabled {
		opacity: 0.3;
		cursor: default;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		border: 1px solid var(--line2);
		padding: 2px 7px;
		font-size: 12px;
		color: var(--fg2);
	}
	.chip[aria-pressed='true'] {
		border-color: var(--fg2);
		background: var(--bg3);
		color: var(--fg);
	}
	.row-btns,
	.inline {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
	}
	.inline select {
		flex: 1;
		width: auto;
	}
	.mini {
		border: 1px solid var(--line2);
		padding: 3px 9px;
		font-size: 12px;
		color: var(--fg2);
	}
	.mini:hover:not(:disabled) {
		color: var(--fg);
		border-color: var(--fg3);
	}
	.mini:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.danger:hover:not(:disabled) {
		color: var(--st-fail);
		border-color: var(--st-fail);
	}
</style>
