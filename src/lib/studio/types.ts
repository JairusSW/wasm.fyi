import type { Component } from 'svelte';
import type { Bench, ProposalId } from '$lib/data/types';

/** Page-specific data a block may need. Blocks that require a key are only offered where it exists. */
export interface StudioCtx {
	bench?: Bench;
	proposal?: ProposalId;
}

export type BlockConfig = Record<string, unknown>;

export interface BlockProps<C extends BlockConfig = BlockConfig> {
	config: C;
	ctx: StudioCtx;
	/** Patch this block's config. Records an undo step unless `record` is false. */
	update: (patch: Partial<C>, record?: boolean) => void;
	editing: boolean;
	/** Height chosen by the user (px), if the block was made shorter. */
	height?: number;
}

export type FieldOption = [value: string, label: string];

export interface Field<C extends BlockConfig = BlockConfig> {
	key: keyof C & string;
	label: string;
	type: 'text' | 'textarea' | 'select' | 'chips' | 'toggle' | 'number' | 'range' | 'expr' | 'configs';
	options?: FieldOption[] | ((c: C) => FieldOption[]);
	help?: string;
	placeholder?: string;
	min?: number;
	max?: number;
	step?: number;
	/** Show the field only when this returns true. */
	when?: (c: C) => boolean;
	/** Returns an error message, or null when valid. */
	validate?: (value: unknown, c: C) => string | null;
	section?: string;
}

export interface BlockDef<C extends BlockConfig = BlockConfig> {
	type: string;
	label: string;
	description: string;
	category: 'Overview' | 'Benchmarks' | 'History' | 'Features' | 'Charts' | 'Content' | 'Page';
	component: Component<BlockProps<C>>;
	defaults: () => C;
	/** Default width in 12-column units. */
	span: number;
	minSpan?: number;
	requires?: keyof StudioCtx;
	/** At most one per page (the block owns page-level anchors or state). */
	unique?: boolean;
	fields?: Field<C>[];
	/** Frame title in edit mode. */
	title?: (c: C) => string;
}

export interface BlockInstance {
	id: string;
	type: string;
	span: number;
	config: BlockConfig;
	/** Max height in px; taller content fades out with a “Show all” control. */
	height?: number;
	/** Collapsed to its title bar. */
	collapsed?: boolean;
}

export interface Layout {
	v: 1;
	blocks: BlockInstance[];
}

/** A ready-made block in the library: a type plus a starting config. */
export interface Template {
	id: string;
	type: string;
	label: string;
	description: string;
	span?: number;
	config: BlockConfig;
}
