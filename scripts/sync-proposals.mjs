#!/usr/bin/env node
// Snapshot the WebAssembly proposal list into src/lib/data/proposals.json.
//
// Sources:
//   - WebAssembly/website features.json — the exact list, names, links and phases shown on
//     webassembly.org/features.
//   - WebAssembly/proposals finished-proposals.md — the spec version each finished proposal shipped in.
// Only identity and phase are imported; support claims are never copied in, because
// wasm.fyi reports measured results only.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RAW = 'https://raw.githubusercontent.com/WebAssembly';
const out = fileURLToPath(new URL('../src/lib/data/proposals.json', import.meta.url));

async function get(url) {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${res.status} ${url}`);
	return res.text();
}

/**
 * github.com/WebAssembly/<repo> → lowercase repo name, or null. Proposals folded into the
 * spec repository are identified by their `proposals/<name>` directory instead.
 */
function repoOf(url) {
	const m = /github\.com\/webassembly\/([^/#?]+)(?:\/[^#?]*?\/proposals\/([^/#?]+))?/i.exec(url || '');
	if (!m) return null;
	const repo = m[1].toLowerCase().replace(/\.git$/, '');
	// Singular/plural drifts between sources (…-conversion vs …-conversions).
	return (repo === 'spec' && m[2] ? m[2].toLowerCase() : repo).replace(/s$/, '');
}

/** Markdown link refs `[label]: url` → Map(label → url). */
function linkRefs(md) {
	return new Map([...md.matchAll(/^\[([^\]]+)\]:\s*(\S+)/gm)].map((m) => [m[1].toLowerCase(), m[2]]));
}

/** Finished proposals → Map(repo → spec version). */
function finishedVersions(md) {
	const refs = linkRefs(md);
	const versions = new Map();
	for (const m of md.matchAll(/^\|\s*\[[^\]]+\]\[([^\]]+)\].*\|\s*([\d.]+)\s*\|\s*$/gm)) {
		const repo = repoOf(refs.get(m[1].toLowerCase()));
		if (repo) versions.set(repo, m[2]);
	}
	return versions;
}

const [website, finished] = await Promise.all([
	get(`${RAW}/website/main/features.json`).then(JSON.parse),
	get(`${RAW}/proposals/main/finished-proposals.md`)
]);

const versions = finishedVersions(finished);

const proposals = Object.entries(website.features).map(([key, f]) => {
	const repo = repoOf(f.url);
	return {
		key,
		name: f.description,
		url: f.url,
		phase: f.phase,
		spec: (f.phase !== 'inactive' && repo && versions.get(repo)) || null
	};
});

proposals.sort((a, b) => a.key.localeCompare(b.key));
writeFileSync(
	out,
	JSON.stringify(
		{
			source: ['https://webassembly.org/features/', 'https://github.com/WebAssembly/proposals/blob/main/finished-proposals.md'],
			retrieved: new Date().toISOString().slice(0, 10),
			proposals
		},
		null,
		'\t'
	) + '\n'
);
console.log(`Wrote ${proposals.length} proposals to ${out}`);
