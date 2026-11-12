// A reader-chosen engine order. Empty means the default alphanumeric order. Every engine list on
// the site (tables, charts, chips) iterates CFG, which applies this order, so one drag reorders all.
export const engineOrder = $state<{ ids: string[] }>({ ids: [] });

/** Move `id` before (or after) `target` in the full current order `ids`. */
export function moveEngine(ids: readonly string[], id: string, target: string, after: boolean): string[] {
	if (id === target) return [...ids];
	const out = ids.filter((x) => x !== id);
	const at = out.indexOf(target);
	if (at < 0) return [...ids];
	out.splice(after ? at + 1 : at, 0, id);
	return out;
}
