import {datasetView,viewData} from './api/view.svelte';
import {versionIdentity} from './version-identity';
import {shortVersion} from './version-identity';
import type { Cfg } from './data/types';

/**
 * Structured tooltip card rendered by the global Tooltip via `data-tip-card`.
 * Every field is optional so a card can be as small as a title + action.
 */
export type TipCard = {
	/** Small uppercase context line, e.g. the column or metric. */
	kicker?: string;
	title?: string;
	/** Runtime identity line rendered with its swatch. */
	who?: { rt: string; be: string; col: string; hollow?: boolean; ver?: string; url?:string };
	value?: string;
	valueColor?: string;
	/** Heatmap colour of the hovered cell, shown as a chip beside the value. */
	heat?: string;
	sub?: string;
	stats?: [string, string][];
	chips?: string[];
	points?: string[];
	note?: string;
	/** What clicking does, without the leading "Click to". */
	action?: string;
	/** A small built-in diagram in place of explanatory text. */
	vis?: 'cohort-each' | 'cohort-shared' | 'avg-geo' | 'avg-mean';
};

export const tipWho = (c: Pick<Cfg, 'rt' | 'be' | 'col' | 'hollow'> & {id?:Cfg['id']}, ver?: string): TipCard['who'] => {
 const config=c.id?viewData.hosts[datasetView.machine].configurations[c.id]:undefined;
 const identity=config?versionIdentity(config.version,config.source):null;
 const label=ver?shortVersion(ver):identity?.label;
 return {rt:c.rt,be:c.be,col:c.col,hollow:c.hollow,ver:label,...(identity?.url&&(!ver||label===shortVersion(config!.version)||label===identity.label)?{url:identity.url}:{})};
};

/** Serialises a card for the `data-tip-card` attribute, dropping empty fields. */
export const tipCard = (card: TipCard) =>
	JSON.stringify(card, (key, v) => (v === '' || v == null || (Array.isArray(v) && !v.length) ? undefined : typeof v==='string'&&key!=='url'&&key!=='href'?shortVersion(v):v));

/** Splits a trailing "Click to …" style line off plain tooltip text. */
export function splitAction(lines: string[]): { lines: string[]; action: string } {
	const last = lines.at(-1) ?? '';
	const m = /^(?:click|double-click)\s+(?:to\s+|for\s+)?(.*)$/i.exec(last);
	return m && lines.length > 1 ? { lines: lines.slice(0, -1), action: m[1] } : { lines, action: '' };
}

const ordinal = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');

/**
 * Tooltip rows placing one cell within its row: "place · 3rd of 12" and the row's best value with
 * its engine. Lower is better. `values[i]` null means the cell itself has no comparable value.
 */
export function rankStats(values: (number | null)[], i: number, names: string[], fmt: (v: number) => string, best = 'fastest'): [string, string][] {
	const ok = values.flatMap((x, k) => (x == null ? [] : [{ x, k }]));
	if (!ok.length) return [];
	const top = ok.reduce((a, b) => (b.x < a.x ? b : a));
	const lead: [string, string] = [best, `${names[top.k]} · ${fmt(top.x)}`];
	const v = values[i];
	if (v == null) return [lead];
	return [['place', `${ordinal(1 + ok.filter((e) => e.x < v).length)} of ${ok.length}`], lead];
}
