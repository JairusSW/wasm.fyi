# Handoff: wasm.fyi — WebAssembly runtime benchmarks site

## Overview
wasm.fyi is a public, inspectable engineering resource for comparing WebAssembly runtimes (wasmtime, wasmer, wazero, v8, wago, …). It answers: what performs best for my workload, which runtimes support the features I need, what changed over time, and what explains the differences. All numbers in the prototype are **synthetic** and labeled as such.

## About the design files
`Wasm Bench v4.dc.html` is a **design reference built in HTML** — a working prototype of intended look and behavior, not production code. Recreate it in the target stack (recommended if starting fresh: a static-first framework such as SvelteKit / Astro / Next with URL-backed state, data loaded from versioned JSON snapshots). The file is self-contained except for `support.js` (prototype runtime only — do not port it).

Open it in a browser to explore. Pages are hash-routed (`#/benchmarks`, `#/history`, `#/features`, `#/simd`, `#/gc`, `#/memory64`, `#/threads`, `#/bench/<id>`, …). All mock data, formatting and derived logic live in the `class Component` script at the bottom — treat it as the spec for data shape and computation.

## Fidelity
**High-fidelity.** Colors, type, spacing, states and interactions are final. Recreate closely.

## Information architecture
Primary nav: **Benchmarks · History · Features**. Landing page at `/`.
- `/` — landing: short intro, fastest-execution leaderboard, area cards, stats tiles, recent events.
- `/benchmarks` — the main comparison surface (below).
- `/history` — time series + change report.
- `/features` — feature status matrix (browsers + runtimes), spec test results, per-proposal performance.
- `/simd`, `/gc`, `/memory64`, `/threads` — proposal pages: status → adoption → performance.
- `/bench/<id>` — benchmark detail: Latency · Memory · Code · History · Run details.
- Runtime profile opens as a drawer from any runtime name.

## Screens

### Benchmarks (`/benchmarks`)
1. **Scope bar** (persistent): machine select (exact CPU + OS), snapshot select, runtime chips (click toggles, double-click solos), expandable advanced options (cache, workers, warmup, flags, instrumentation).
2. **Headline leaders** strip: fastest compilation / instantiation / execution / smallest machine code. Each shows runtime+backend, absolute value, comparable-workload count. "No clear leader" allowed.
3. **Matrix carousel** — ‹ title › then, separated by a 1px left border, `Snapshot · Sep 28, 2026 03:41 UTC` + `2 days ago` (fg3). Views: **Latency, Memory, Machine Code, Correctness**. Rows = runtime configs; columns = phases/categories; trailing **Correct** column (`n / 1,284`). Cells show absolute numbers in actual units (e.g. `4.9 µs`, `21.7 MB`, `612 KB`) with heat backgrounds. Click a cell → result drawer (absolute, distribution dots, sample counts, correctness, run record, copyable `wbench run …` command). Click column header → per-benchmark matrix.
4. **Per-benchmark matrix**: grouped by corpus (Applications, Algorithms, Runtime mechanisms, Proposal workloads, Scaling), expandable groups and parameterized cases, sticky row/column labels, tags (`#simd`) filter.
5. **Over time** carousel: "Execution History", "Compilation History", "Instantiation History", "Memory History", "Machine Code History", "Correctness History". One sparkline row per runtime with hover crosshair + tooltip.

### History (`/history`)
- Metric tabs (same six), mode: Absolute / Change from pinned run, click-sets-from/to toggle, From/To selects.
- Chart 860×280 viewBox, log scale in absolute mode. X labels are **months** (first snapshot of each month; first label includes year).
- Shaded range between solid **FROM mm-dd / TO mm-dd** tagged lines = change-report range (tags clamp at chart edges).
- Dashed vertical lines = release / harness / hardware events (names only in tooltip).
- **◆ diamonds** on a line = that runtime's version bump; selected runtime shows the version label above.
- Hover: crosshair, dots on every line, tooltip sorted best-first with value, version (`◆ new` on bump week), Δ vs previous week (green/red), event names. Touch: tap shows and holds.
- Key row under chart; "Report for" runtime chips.
- Change report: improved / regressed / inconclusive workloads using a documented practical-change threshold; never attributes causality.

### Features (`/features`)
- Feature status matrix: features × browsers/runtimes, glyph + text (enabled by default / flag / unavailable / unknown). Two independent dimensions: availability vs observed spec test results.
- Spec test results: families expandable, cells show pass/total, segmented status bar, counting unit; click → failure drawer (tests, expected/actual, diagnostics, suite commit).
- Proposal performance table.

### Proposal pages
Status (phase, spec links, standardization history) · Adoption (runtimes, browsers, toolchains) · Performance. SIMD: matched scalar vs SIMD — speedup within runtime **and** absolute time across runtimes, kernel table. GC: allocation throughput, GC/linear ratio, collector settings. Memory64: matched 32 vs 64-bit. Threads: scaling vs ideal line, contention, memory per worker.

### Benchmark detail
Phase bars (compile, instantiate, first call, steady), memory timeline with annotated phase bands (real time vs phase-aligned toggle, RSS/PSS/linear selector), per-phase memory table (peak* sampled / end), code table, history sparklines, run record.

## Interactions & behavior
- **Tooltips everywhere** via a single delegated tooltip: any element with `data-tip` shows a fixed-position tooltip (max-width 320px, 12px IBM Plex Sans, `white-space: pre-line`, bg `--bg`, 1px `--line2` border, shadow `0 6px 18px rgba(0,0,0,.28)`, offset +14/+16 from cursor, flips at viewport edges). Also on keyboard focus; hidden on scroll/click. Content: entity × column, value, and what clicking does.
- Carousels: ‹ › buttons (28×28, 1px `--line2`) cycle views; tabs also available.
- Missing data states must be distinct: unsupported, disabled, failed, crashed, timed out, not measured, not applicable (interpreters → "n/a" for machine code, never 0).
- All filters should be URL-backed; drawers close on Esc.

## Heatmap scale (standardized)
One scale everywhere — `oklch(0.74 0.12 H / α)`, α ≤ 0.34:
- good: H=165 (green) · mid: H=90 (yellow) · bad: H=30 (red)
- Ratio cells (latency/memory/code vs baseline): `l = |log2(r)|`; |l| < 0.04 → transparent; r<1 → good, α = 0.085·l + 0.04; r>1 → mid if l<0.6 else bad, same α.
- Count cells (Correctness view, Correct column): normalize within column across visible runtimes to badness b∈[0,1]; b<0.2 good (α .2−.5b), b<0.6 mid (α .1+.25b), else bad (α .1+.25b). Zero counts in failure columns stay transparent.

## Design tokens
Fonts: **IBM Plex Sans** (UI, 400/500/600), **IBM Plex Mono** (numbers, ids, versions; `font-variant-numeric: tabular-nums`). Base 13px; small labels 11px; micro 10px; titles 15px/600.

Dark (default) / Light:
| token | dark | light |
|---|---|---|
| --bg | #0d0e10 | #f6f6f4 |
| --bg2 | #131518 | #ffffff |
| --bg3 | #1a1d21 | #f0f0ed |
| --line | #23272c | #e3e3df |
| --line2 | #31363c | #cfcfca |
| --fg | #e4e6e9 | #16171a |
| --fg2 | #a6acb4 | #4a4e55 |
| --fg3 | #7d848d | #676c74 |
| --hover | #1c1f24 | #f1f1ee |
| --focus | oklch(0.82 0.14 95) | oklch(0.55 0.18 250) |

Runtime identity (dark / light) — solid swatch = primary backend, hollow = alternate backend:
wasmtime oklch(.72 .13 255)/(.54 .16 255) · wasmer (.79 .13 75)/(.62 .14 70) · wazero (.72 .14 305)/(.54 .17 305) · v8 (.77 .11 190)/(.57 .11 195) · wago (.73 .14 350)/(.57 .18 355)

Test status (kept distinct from runtime colors): pass (.72 .14 150) · fail (.67 .19 27) · crash (.62 .21 5) · warn (.77 .14 60) · skip #495058 (light #c7c9cc). Deltas: --good (.72 .11 170), --bad (.72 .13 45).

Shape: square corners (radius 0), 1px borders, no gradients, shadows only on floating tooltips/drawers. Spacing is compact: cell padding 7×12px, section gaps 10–16px.

## Data model (from the prototype)
- `CFG`: runtime configs `{id, rt, ver, be, kind, interp?}`.
- `SNAPS`: weekly snapshots; `EVENTS`: releases/harness/corpus changes; `verAt(cfg, i)`: version per snapshot.
- Aggregates: geometric mean of per-workload ratios over a shared eligible workload set; corpus-balanced weighting; excluded workloads listed.
- Every result resolves to a run record (runtime commit, flags, artifact, toolchain, machine, harness rev, cache/warmup policy, correctness, samples, raw data, repro command).

## Files
- `Wasm Bench v4.dc.html` — the full prototype (all pages, mock data, logic).
