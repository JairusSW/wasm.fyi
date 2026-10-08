/**
 * Pointer interaction for picking a [from, to] snapshot range on a chart:
 * - drag selects the range directly;
 * - a click sets an anchor, and a shift+click selects anchor → that point.
 *   A shift+click without an anchor sets one, so click, shift+click and
 *   shift+click, shift+click both work. `clear()` drops the anchor.
 *
 * `toIndex` maps the pointer's horizontal fraction (0…1) across the element
 * receiving the events to a snapshot index.
 */
export class RangeSelect {
	drag = $state<{ a: number; b: number } | null>(null);
	anchor = $state<number | null>(null);
	/** Whether the pointer has moved to another point since pressing. */
	dragging = $derived(!!this.drag && this.drag.a !== this.drag.b);
	band = $derived(this.dragging ? ([Math.min(this.drag!.a, this.drag!.b), Math.max(this.drag!.a, this.drag!.b)] as const) : null);

	constructor(
		private toIndex: (fraction: number) => number,
		private onselect: (from: number, to: number) => void
	) {}

	private at(e: PointerEvent) {
		const r = (e.currentTarget as Element).getBoundingClientRect();
		return this.toIndex(r.width ? (e.clientX - r.left) / r.width : 0);
	}

	down = (e: PointerEvent) => {
		if (e.button !== 0) return;
		// Touch keeps native scrolling; a tap still arrives as down + up.
		if (e.pointerType !== 'touch') {
			e.preventDefault();
			(e.currentTarget as Element).setPointerCapture(e.pointerId);
		}
		const i = this.at(e);
		this.drag = { a: i, b: i };
	};

	move = (e: PointerEvent) => {
		if (this.drag) this.drag.b = this.at(e);
	};

	up = (e: PointerEvent) => {
		if (!this.drag) return;
		const { a, b } = this.drag;
		this.drag = null;
		if (a !== b) this.select(a, b);
		else if (e.shiftKey && this.anchor != null && this.anchor !== a) this.select(this.anchor, a);
		else this.anchor = a;
	};

	cancel = () => {
		this.drag = null;
	};

	clear = () => {
		this.anchor = null;
	};

	private select(a: number, b: number) {
		this.anchor = null;
		this.onselect(Math.min(a, b), Math.max(a, b));
	}
}
