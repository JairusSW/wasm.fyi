<h1 align="center"><pre>╦ ╦╔═╗╔═╗╔╦╗  ╔═╗╦ ╦╦
║║║╠═╣╚═╗║║║══╠╣ ╚╦╝║
╚╩╝╩ ╩╚═╝╩ ╩  ╚   ╩ ╩</pre></h1>

<p align="center">
  webassembly runtimes, measured and explained
</p>

<p align="center">
  <a href="https://github.com/JairusSW/wasm.fyi/actions/workflows/check.yml"><img src="https://github.com/JairusSW/wasm.fyi/actions/workflows/check.yml/badge.svg" alt="Website checks"></a>
  <a href="https://github.com/JairusSW/wasm.fyi/actions/workflows/corpus.yml"><img src="https://github.com/JairusSW/wasm.fyi/actions/workflows/corpus.yml/badge.svg" alt="Corpus source builds and correctness"></a>
</p>

<p align="center">
  <a href="https://wasm.fyi">website</a> ·
  <a href="corpora/README.md">corpus sources</a> ·
  <a href="docs/updating.md">updating results</a> ·
  <a href="docs/llm-access.md">data access</a> ·
  <a href="https://github.com/JairusSW/wasm.fyi/issues">issues</a> ·
  <a href="https://github.com/sponsors/JairusSW">sponsor</a>
</p>

wasm.fyi compares WebAssembly runtimes across real workloads, feature support,
and release history. Pick a workload, compare engines, and inspect the evidence
behind each result.

> [!NOTE]
> Missing, unsupported, failed and unmeasured results stay visible. Corpus
> checks establish correctness for their specific contracts; official test
> suites have separate coverage and results.

## Why wasm.fyi?

- **Workload-specific comparisons.** Compare execution, compilation and memory
  for the programs you care about.
- **Inspectable results.** Measurements retain artifact hashes, runtime
  configurations, host details and raw evidence.
- **Feature coverage.** Explore SIMD, GC, memory64, threads, WASI and other
  WebAssembly features with explicit support states.
- **Release history.** Follow changes over time using the artifacts and
  configurations recorded with each measurement.
- **Build every corpus from source.** Modify the kernels, applications and
  feature probes, rebuild their `.wasm` files, and check their behavior before
  collecting timings.

## Explore the results

[**Visit wasm.fyi →**](https://wasm.fyi)

Start with Benchmarks to compare workloads, Features to inspect support, or
History to follow runtime changes. Open a result to see its evidence. Filters
are stored in the URL, so you can share the comparison you're looking at.

## Run locally

Requires Node.js and pnpm. The pinned dependency manager is
`pnpm@11.15.1`; corpus verification uses Node **26.4.0**.

```sh
git clone https://github.com/JairusSW/wasm.fyi.git
cd wasm.fyi
pnpm install --frozen-lockfile
pnpm dev
```

The site uses Svelte 5 and SvelteKit. Production builds are static HTML and can
be served by any static host, with `404.html` as the fallback for unknown paths.

```sh
pnpm build
pnpm preview
```

## Build the corpus

The application corpus contains **166 algorithms across 27 categories**:
102 original import-free C kernels and 64 upstream workloads. The feature
corpus adds **241 contracts across 119 artifacts**.

Every configured artifact has a source build. Original sources, wrappers,
fixtures and compiler ports are included here; complete upstream source trees
are fetched at pinned revisions. The default corpus has no Emscripten modules.
Import-free kernels run without WASI; command workloads use WASI where needed.

After installing the [corpus build prerequisites](corpora/README.md#build-everything):

```sh
just corpus-build-all
```

This builds the application and feature artifacts, including the WASI component
adapter, then checks core and Preview 1 contracts against V8. Component
contracts are checked separately with Wasmtime; async type probes are checked
for compilation only. A failed build or result mismatch fails the workflow.

See [corpus sources and correctness](corpora/README.md) for focused builds,
source edits, patches, toolchain versions and exact checks.

## Update measurements

The site reads checksum-verified reports collected by
[wasm-bench](https://github.com/JairusSW/wasm-bench). Correctness checks and
performance collection are separate steps.

With `just` installed and the benchmark harness configured:

```sh
just bench-doctor        # inspect the host and adapters
just bench-build         # build the measurement tools
just corpus-check        # check results before timing
just refresh             # collect on configured hosts and rebuild the site
```

To import existing reports:

```sh
just update
```

Rebuilt artifacts need fresh measurements. Historical results keep their
original artifact hashes; changing today's corpus does not rewrite the past.

See [updating results](docs/updating.md),
[benchmark integration](docs/wasmbench-integration.md), and
[features and history](docs/features-and-history.md) for collection and
publication workflows.

## Data access

Every build generates `/llms.txt`, `/llms-full.txt`, `/data/llm/index.json`,
benchmark JSON shards, `robots.txt` and `sitemap.xml` from the same verified data
as the UI. Generation is deterministic and runs offline.

See [machine-readable access](docs/llm-access.md) for schemas, provenance and
base-path behavior.

## Develop

```sh
just setup
just verify             # type checks, tests, evidence checks and static build
just preview
```

| Path | Contents |
| --- | --- |
| `src/routes/` | Benchmark, comparison, feature and history pages |
| `src/lib/` | Shared UI, filters, formatting and derived calculations |
| `scripts/view-data.mjs` | Website data generated from verified evidence |
| `corpora/` | Corpus sources, contracts, fixtures and build metadata |
| `adapters/` | Runtime adapters |
| `data/` | Retained snapshots and evidence |
| `scripts/` | Builds, collection, imports and verification |

Keep unsupported, disabled, failed, crashed, timed-out, unmeasured and
inapplicable results distinct. A missing measurement is never zero. Match
results to their artifact digests before displaying them.

For GitHub Pages, `just pages-build` builds with the project path and
`just deploy` dispatches deployment of the committed `main` branch. See
[updating results](docs/updating.md) for configuration.

## Learn more

[Corpus guide](corpora/README.md) ·
[Application workloads](docs/corpora.md) ·
[Features and history](docs/features-and-history.md) ·
[Data access](docs/llm-access.md) ·
[Issues](https://github.com/JairusSW/wasm.fyi/issues) ·
[Sponsor](https://github.com/sponsors/JairusSW)
