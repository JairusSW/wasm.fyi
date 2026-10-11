/**
 * Admin analytics: the JSON contracts the dashboard renders. The backend answers `GET /api/admin/analytics?range=…`
 * with an `Analytics` object; nothing in the page depends on how the numbers are produced.
 *
 * API traffic is split three ways by how the request arrived:
 *   - website: the site's own pages calling the API (same-origin fetch: `Sec-Fetch-Site:
 *     same-origin` and our `Origin`), i.e. people browsing.
 *   - programmatic: everything else that identifies as a client — scripts, CI, notebooks.
 *   - bots: known crawlers and AI fetchers, by user agent and verified ASN.
 */

/** History is kept for 30 days; older data survives only in the all-time totals. */
export type Range = '24h' | '7d' | '30d';
export type Origin = 'website' | 'programmatic' | 'bots';
export const ORIGINS: Origin[] = ['website', 'programmatic', 'bots'];

export type Point = {
	/** Bucket start, epoch ms. */
	at: number;
	visitors: number;
	pageviews: number;
	api: Record<Origin, number>;
};

export type Kpi = {
	/** False when the full comparison period is outside retained history. */
	comparisonAvailable?: boolean;
	/** False for metrics that are not collected. */
	available?: boolean;
	key: string;
	label: string;
	value: number;
	/** Same metric over the previous period of equal length. */
	prev: number;
	unit?: 'ms' | '%' | 's';
	/** Lower is better (latency, errors, bounce). */
	invert?: boolean;
	spark: number[];
	hint: string;
};

export type Client = {
	name: string;
	/** User agent family, e.g. `python-requests/2.32`. */
	agent: string;
	origin: Exclude<Origin, 'website'>;
	/** Network the requests came from. */
	network: string;
	requests: number;
	errors: number;
	topEndpoint: string;
	lastSeen: number;
	spark: number[];
};

export type Endpoint = { path: string; requests: Record<Origin, number>; p50: number; p95: number; errors: number };
export type Share = { label: string; value: number; detail?: string };
export type LogLine = { at: number; status: number; method: string; path: string; origin: Origin; agent: string; ms: number };

export type Analytics = {
	range: Range;
	places: Place[];
	generated: number;
	kpis: Kpi[];
	series: Point[];
	clients: Client[];
	endpoints: Endpoint[];
	pages: (Share & { avgTime: number })[];
	referrers: Share[];
	countries: Share[];
	devices: Share[];
	browsers: Share[];
	runtimes: Share[];
	workloads: Share[];
	log: LogLine[];
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const BUCKET: Record<Range, number> = { '24h': HOUR, '7d': 6 * HOUR, '30d': DAY };
// ── Bandwidth ──
// Bytes leaving the server (down to visitors and clients: pages, assets, API JSON) and arriving
// (up: request bodies, mostly capture uploads from benchmark hosts). The backend should answer
// `GET /api/admin/bandwidth?window=…` with a `Bandwidth`, and stream `LiveRate`s for the live card.

export type BwWindow = '1h' | '1d' | '1w' | '1m';
export type BwPoint = { at: number; down: number; up: number };
export type Bandwidth = { comparisonAvailable?: boolean; window: BwWindow; step: number; series: BwPoint[]; down: number; up: number; prevDown: number; prevUp: number; peakDown: number };
export type LiveRate = { at: number; down: number; up: number };

const MIN = 60_000;
export const BW_STEP: Record<BwWindow, number> = { '1h': MIN, '1d': 15 * MIN, '1w': 2 * HOUR, '1m': DAY };
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];
export function fmtBytes(n: number) {
	let i = 0;
	while (Math.abs(n) >= 1000 && i < UNITS.length - 1) {
		n /= 1000;
		i++;
	}
	return `${n < 10 && i ? n.toFixed(2) : n < 100 && i ? n.toFixed(1) : Math.round(n)} ${UNITS[i]}`;
}
export const fmtRate = (bytesPerSec: number) => `${fmtBytes(bytesPerSec)}/s`;

// ── All time ──
// Running totals kept forever (cheap counters), unlike the 30-day history. The backend should
// answer `GET /api/admin/totals` with an `AllTime`.

export type AllTime = {
	/** When counting started, epoch ms. */
	since: number;
	visitors: number;
	pageviews: number;
	apiRequests: number;
	apiByOrigin: Record<Origin, number>;
	/** Bytes served by /api (responses) and received by it (request bodies). */
	apiDown: number;
	apiUp: number;
	/** Every byte across the whole site, pages and assets included. */
	totalDown: number;
	totalUp: number;
	clients: number;
};

// ── Locations ──
// City-level positions from IP geolocation (never exact addresses). The backend adds
// `places` to the analytics response, aggregated per city over the selected range.

export type Place = { city: string; country: string; lat: number; lon: number; visitors: number; api: number };

