# wasm.fyi

A public, inspectable reference for comparing WebAssembly runtimes: what performs best for a workload, which runtimes support which features, what changed over time, and why.

> **Preview:** every number on the site is synthetic and labeled as such.

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

## Replacing the synthetic data

The modules in `src/lib/data/` mirror the prototype's data shapes. When the harness publishes versioned snapshot JSON, load it in place of these modules and keep `model.ts` as the derivation layer.

## Update and deployment workflow

Use `just` for the full workflow:

```sh
just setup
just verify             # checks, tests, verified evidence, static site
just update             # import configured reports and rebuild transactionally
just bench-build
just corpus-check       # 65 Wago benchmarks / 72 exact contracts
just refresh            # collect fresh passes, retain snapshots and rebuild
just deploy             # deploy the committed branch to GitHub Pages
```

The existing pages now consume checksum-verified measurements for both hosts. The workload catalogue includes 72 Wago application contracts and 232 original feature contracts. Layout and styling are preserved; factual labels distinguish process lifetime RSS, extracted native images, compile-only checks and retrospective history. Missing measurements remain explicit.

The [feature and history workflow](docs/features-and-history.md) covers 232 feature
contracts across all 25 displayed families, 32 real worker tests, and eight weekly
Wago revisions. The existing views consume the verified data.
