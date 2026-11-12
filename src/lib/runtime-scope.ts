// Shared runtime selection for the scope bar, its engine tray and the filter panel: why a runtime
// is in or out, and how to bring one back by lifting only the constraints that exclude it.
import { ui } from './state.svelte';
import { CFG, execOf, langOf } from './data/runtimes';
import type { CfgId } from './data/types';
import { emptyRuntimeFilters, nameMatcher } from './runtime-filters';

export type Why = { kind: 'shown' | 'manual' | 'exec' | 'lang' | 'pass' | 'name' | 'rank'; text: string };

export const passOf = (id: string) => ui.filterRows.find((r) => r.id === id)?.values.pass ?? null;

/** Why each runtime is in or out, naming the first constraint that removes it. */
export function exclusions(ids: readonly CfgId[]): Map<CfgId, Why> {
	const matches = nameMatcher(ui.runtimeFilters.name);
	const rows = new Map(ui.filterRows.map((r) => [r.id, r]));
	const out = new Map<CfgId, Why>();
	for (const id of ids) {
		const c = CFG.find((x) => x.id === id);
		if (!c) continue;
		const pass = rows.get(id)?.values.pass ?? null;
		let w: Why;
		if (ui.exec !== 'all' && execOf(c) !== ui.exec) w = { kind: 'exec', text: execOf(c) === 'interpreter' ? 'interpreter' : 'compiler' };
		else if (ui.lang !== 'all' && langOf(c) !== ui.lang) w = { kind: 'lang', text: langOf(c) };
		else if (ui.hide[id]) w = { kind: 'manual', text: 'hidden' };
		else if (!ui.scope.hide[id]) w = { kind: 'shown', text: '' };
		else if (pass != null && pass < ui.passRate) w = { kind: 'pass', text: `below ${ui.passRate}%` };
		else if (!matches(rows.get(id)?.name ?? c.rt)) w = { kind: 'name', text: 'name' };
		else w = { kind: 'rank', text: 'outside ranking' };
		out.set(id, w);
	}
	return out;
}

/** Show one runtime by lifting only the constraints that exclude it. */
export function includeRuntime(id: CfgId) {
	const c = CFG.find((x) => x.id === id);
	if (!c) return;
	const w = exclusions([id]).get(id);
	if (ui.exec !== 'all' && execOf(c) !== ui.exec) ui.exec = 'all';
	if (ui.lang !== 'all' && langOf(c) !== ui.lang) ui.lang = 'all';
	const pass = passOf(id);
	if (pass != null && pass < ui.passRate) ui.passRate = Math.floor(pass);
	if (w?.kind === 'name' || w?.kind === 'rank') ui.runtimeFilters = emptyRuntimeFilters();
	ui.hide = { ...ui.hide, [id]: false };
}

export function toggleRuntime(id: CfgId) {
	if (!ui.scope.hide[id]) ui.hide = { ...ui.hide, [id]: true };
	else includeRuntime(id);
}

export function soloRuntime(id: CfgId) {
	includeRuntime(id);
	ui.hide = Object.fromEntries(CFG.map((x) => [x.id, x.id !== id]));
}

export function resetScope() {
	ui.runtimeFilters = emptyRuntimeFilters();
	ui.exec = 'all';
	ui.lang = 'all';
	ui.passRate = 0;
	ui.hide = {};
}
