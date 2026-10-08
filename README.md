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
just dev
```

The default `just dev` command runs the website and Go API together behind local
Caddy. Install just, Caddy (`brew install just caddy` on macOS) and Go 1.27.1+.
`just dev-caddy` is also available; `just dev-frontend` starts the frontend alone.
Open `http://localhost:8080`. Ctrl+C stops all three services. API data and a
private generated publisher token persist under `.wasmfyi/local/`; the website
reads indexed current measurements from a compact database. An empty database
shows an explicit empty state. Set `WASMFYI_DATA_DIR` to choose another private
data root. See [service/README.md](service/README.md) and
[database design](docs/benchmark-database.md).

For the production build, run `just serve-local`. It serves Go and Caddy at the
same address and accepts authenticated compact captures. No report import,
prepared-page export or evidence audit is needed.

The site uses Svelte 5 and SvelteKit. Production builds are static HTML and can
be served alongside the API by the Go service. Its application shell handles newly imported workload routes; unknown assets return 404. A static frontend host needs a same-origin proxy to the API.

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

The site reads compact measurements collected by
[wasm-bench](https://github.com/JairusSW/wasm-bench). Correctness checks and
performance collection are separate steps.

`just bench` now defaults to compact latency capture: one timing pass for
compilation, instantiation, first call and steady execution. Kernel peak RSS is captured
when each timing process exits; code size needs only one cold compile sample.
Report analysis, tool archives and evidence export are skipped. Correctness
validation, warmups and configured samples remain enabled. Host-call fixtures
retain calibrated batches. Captures publish directly to the local database with
one atomic commit. The API has `/api/platforms`, `/api/benchmarks` with signed
cursors, and authenticated `/api/captures`. Start `just serve-local` first; use `--api-url` for another
server or `--no-live` for offline capture. `--full --no-live` retains legacy
diagnostic reports outside the active database.

With `just` installed and the benchmark harness configured:

```sh
just bench-doctor        # inspect the host and adapters
just bench-build         # build the measurement tools
just corpus-check        # check results before timing
just bench               # capture latencies on configured hosts
```

The database retains the latest cells and deduplicated metadata. Older retries
cannot replace newer measurements. Historical data and evidence were cleared;
there is no automatic migration from the former report store.

See [updating results](docs/updating.md),
[benchmark integration](docs/wasmbench-integration.md), and
[features and history](docs/features-and-history.md) for collection and
publication workflows.

## Data access

See [API.md](API.md) for the HTTP endpoint reference, authentication, pagination,
comparison scopes and request examples.

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

Capture, resume, SSH workers, cached corpus builds and deployment: [benchmark commands](docs/benchmark-workflow.md).
