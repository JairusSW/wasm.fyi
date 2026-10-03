# wasm.fyi

A public, inspectable reference for comparing WebAssembly runtimes: what performs best for a workload, which runtimes support which features, what changed over time, and why.

> The deployed UI consumes checksum-verified measured evidence. Missing, failed and unsupported results remain explicit; representative corpus tests are not complete specification conformance.

## Stack

- [SvelteKit](https://svelte.dev/docs/kit) (Svelte 5) prerendered to static HTML with `@sveltejs/adapter-static`
- No runtime dependencies; IBM Plex Sans / Mono from Google Fonts

## Development

```sh
pnpm install
pnpm dev        # local dev server
pnpm check      # svelte-check + TypeScript
pnpm test       # unit tests (vitest)
pnpm build      # static site in build/
pnpm preview    # serve the production build
```

The `build/` directory can be deployed to any static host. Unknown paths fall back to `404.html`.

## Layout

| Path | What lives there |
| --- | --- |
| `src/lib/data/` | Snapshot data (runtimes, aggregates, corpus, feature status, spec results) and its types |
| `src/lib/model.ts` | Pure derived computations: ratios, absolute values, per-workload results, series, leaders, spec-test splits |
| `src/lib/format.ts`, `heat.ts` | Number formatting and the single heatmap scale |
| `src/lib/state.svelte.ts` | Global UI state; URL-backed filters are declared in `FIELDS` |
| `src/lib/components/` | Shared UI (header, scope bar, drawer, tooltip, controls) and page sections |
| `src/routes/` | `/`, `/benchmarks`, `/history`, `/features`, `/simd` · `/gc` · `/memory64` · `/threads`, `/bench/<workload>`, `/compare` |
| `design_handoff_wasm_fyi/` | Original design handoff — the HTML prototype and its spec |

## Conventions

- **URL-backed state.** Scope (`m`, `snap`, `rt`) persists across pages; page filters (e.g. `metric`, `view`, `from`/`to`) reset when absent from the URL. Defaults are omitted from the query string.
- **Missing is never zero.** Unsupported, disabled, failed, crashed, timed out, not measured and not applicable are distinct states (`src/lib/data/status.ts`).
- **Tooltips.** Add `data-tip="…"` to any element; one delegated tooltip handles hover and keyboard focus.
- **Drawers** (result cell, spec-test failures, runtime profile) are global and close on Esc.
- **Keyboard:** `/` focuses search, ← → cycle the over-time metric on Benchmarks and History.

## Measured data

The modules in `src/lib/data/` retain the original UI data shapes. `scripts/view-data.mjs` regenerates the measured projection from checksum-verified report evidence before checks, tests and builds; `model.ts` remains the derivation layer.

## Update and deployment workflow

Use `just` for the full workflow:

```sh
just setup
just verify             # checks, tests, verified evidence, static site
just update             # import configured reports and rebuild transactionally
just bench-build
just corpus-check       # 166 application contracts; correctness only
just refresh            # collect fresh passes, retain snapshots and rebuild
just deploy             # deploy the committed branch to GitHub Pages
```

The existing pages now consume checksum-verified measurements for both hosts. The workload catalogue includes 166 application contracts across 27 use-case categories and 232 original feature contracts. Newly prepared application entries have no invented timings. Layout and styling are preserved; factual labels distinguish process lifetime RSS, extracted native images, compile-only checks and retrospective history. Missing measurements remain explicit.

The [feature and history workflow](docs/features-and-history.md) covers 232 feature
contracts across all 25 displayed families, 32 real worker tests, and eight weekly
Wago revisions. The existing views consume the verified data.

## LLM and crawler access

Every `pnpm build` (including `just verify` and the Pages deployment workflow)
regenerates `/llms.txt`, `/llms-full.txt`, `/data/llm/index.json`, benchmark JSON
shards, `robots.txt` and `sitemap.xml` from the same verified data as the UI.
Generation is offline and deterministic. There is no separate scheduled job or
manual copy of benchmark numbers to keep up to date.

See [machine-readable access](docs/llm-access.md) for the data contract, provenance,
URL/base-path behavior, and validation commands.

The [application corpus](docs/corpora.md) covers 27 workload categories with pinned application/library artifacts and original kernels at multiple sizes. Use `just applications-check` and `just corpus-audit` before manual overnight collection.

## Studio: modular, customizable pages

Every page is a layout of **blocks** on a 12-column grid (`src/lib/studio/`). It looks exactly as designed until you change it.

- **Move anything:** hover a block and drag the ✥ grip, no mode needed. Press **Customize** (or **E**) for the full editor, where the whole title bar drags.
- **Resize:** drag a block's right edge to snap its width to grid columns. Drag its bottom edge to make it shorter; taller content fades out with a *Show all* button, and dragging to the top collapses it to its title bar.
- **Reorder columns:** drag any table column header. Runtime columns share one order across every table, chart and the scope bar (Alt+←/→ from the keyboard).
- **Add blocks** from the library, which shows a live preview of each with current data. Click to add it, or drag it straight onto the page.
- **Charts** come in four kinds, each answering one question: *Ranking*, *Trade-off* (scatter), *By workload* (heatmap) and *History*. Pick a measure, or write a formula such as `compile + inst + first + 999 * steady`. A small, safe expression language (`expr.ts`, no `eval`) evaluates it. Missing inputs stay missing, and averages use workloads measured on every runtime, saying so when they can't. Charts export as CSV, SVG or PNG.
- **Dashboards** at `/studio`, **share links** (the layout travels in the URL fragment), JSON export/import, undo/redo (⌘Z / ⇧⌘Z, or the Undo button on toasts) and a **⌘K** command palette.

Layouts are saved in `localStorage` (`wasmfyi:studio:v1`, column order in `wasmfyi:order:v1`) as overrides on the defaults in `registry.ts`. Unknown blocks are dropped and configs repaired on load (`sanitize`).

To add a block: write a component taking `BlockProps`, then register it in `BLOCKS` with defaults, a default width and an optional settings schema. The settings panel is generated from it.
