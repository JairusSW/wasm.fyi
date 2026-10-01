// The one heatmap scale used everywhere: oklch(0.74 0.12 H / α), α ≤ 0.34.

const HUE = { good: 165, mid: 90, bad: 30 } as const;
type Tone = keyof typeof HUE;

export const heatColor = (tone: Tone, a: number): string =>
	`oklch(0.74 0.12 ${HUE[tone]} / ${Math.min(0.34, a).toFixed(3)})`;

/**
 * Ratio cells (latency / memory / code vs baseline). Within ±0.04 log2 units the
 * cell stays transparent; faster is green, slower is yellow then red past 0.6.
 */
export const heatRatio = (r: number | null | undefined): string => {
	if (r == null || !Number.isFinite(r)) return 'transparent';
	const l = Math.abs(Math.log2(r));
	if (l < 0.04) return 'transparent';
	const a = l * 0.085 + 0.04;
	return r < 1 ? heatColor('good', a) : heatColor(l < 0.6 ? 'mid' : 'bad', a);
};

/** Count cells: `b` is badness normalized within the column across visible runtimes, 0…1. */
export const heatCount = (b: number): string =>
	b < 0.2
		? heatColor('good', 0.2 - b * 0.5)
		: b < 0.6
			? heatColor('mid', 0.1 + b * 0.25)
			: heatColor('bad', 0.1 + b * 0.25);
