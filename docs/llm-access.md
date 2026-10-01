# Machine-readable access

Start at [`/llms.txt`](https://wasm.fyi/llms.txt) for the short navigation and
interpretation guide, or [`/data/llm/index.json`](https://wasm.fyi/data/llm/index.json)
for the versioned JSON manifest. These are ordinary static files and need no
JavaScript, authentication, API key, or special crawler user-agent.

## Published files

| Path | Contents |
| --- | --- |
| `/llms.txt` | Concise resource index and measurement caveats |
| `/llms-full.txt` | Expanded reference: complete workload catalogue, host/configuration labels, metric definitions, feature coverage, report provenance and links to all recorded benchmark values |
| `/data/llm/index.json` | Schema version, units, hosts, configuration slots, source digests, shard URLs/checksums, evidence/history/worker links |
| `/data/llm/workloads.json` | Artifact SHA-256, exact workload contract, reset/oracle, work unit and page URL; excludes the UI's implicit-baseline convenience timing |
| `/data/llm/reports.json` | Report IDs, source metadata, raw evidence and summary URLs |
| `/data/llm/benchmarks-<host>-<snapshot>-<metric>.json` | Explicit records with workload/configuration/metric, status, value, unit, interval, launch medians, reason and report ID |
| `/data/llm/features.json` | Configuration-pinned coverage summary; links to all exact cases in `/wasmbench/feature-support.json` |
| `/data/llm/schema.json` | JSON Schema 2020-12 for each benchmark shard |
| `/sitemap.xml` | Canonical public routes, every measured workload page and the LLM text resources |
| `/robots.txt` | Allow crawling, sitemap URL and commented LLM/JSON discovery links |

Benchmark shards are split by host, snapshot and metric so consumers can fetch only
the relevant slice rather than download all metrics. The manifest records each
shard’s byte size, record count and SHA-256.

The HTML has canonical and alternate links, and the footer links directly to the
LLM reference and data manifest. Crawlers are allowed; this does not guarantee
that any particular search engine or LLM will crawl or use the files.

## Interpretation contract

- Shard records use the **same packed measurement projection as the UI**, decoded
  without rounding. `ok` with numeric zero is a real zero. Non-ok values are
  `null`, and reasons (including reason index zero) remain intact. Omitted
  combinations are `not-measured`, never implicitly unsupported or zero.
- `s1` means newest matching evidence **per configuration/workload/host**; `s2`
  means previous matching evidence. They are not globally simultaneous runs.
  A newer failure is not backfilled with an older successful value.
- Resolve every record's `report` in `reports.json`. Use the exact configuration,
  runtime identity, flags, host, collection timestamp, launch count and policy
  in its sealed evidence before comparing results. The host's configuration label
  is not a substitute for that per-record identity.
- Timing is in `ms`, process lifetime peak RSS in `MiB`, extracted native images
  in `KiB`. A timing is per reported operation/iteration, not necessarily per
  invocation. Work unit and units per invocation are in the workload contract.
  RSS is not a heap measurement or phase subtraction; extracted images are not
  an active-code-only measurement.
- Coverage counts are **metric cells**, not passed workloads. Feature evidence is
  representative exact-oracle corpus coverage under pinned adapters, not whole
  specification conformance. Compile-only does not mean executed. Core adapters
  do not measure unloaded plugins or browser release support.
- Historical Wago revisions were collected retrospectively. The comparison
  engines are fixed baselines. Target week is not collection time.
- There is no global winner summary, and no aggregate normalizes away missing
  coverage. The full text is a reference with detailed values in linked JSON
  shards rather than a single enormous table of measurements.

## Automatic build/deployment integration

`pnpm build` always performs these steps, in order:

1. `stage-data.mjs` checksum-validates and stages canonical evidence plus feature,
   history and worker evidence into `static/wasmbench/`
2. `view-data.mjs` regenerates `src/lib/data/measurements.json` from validated inputs
3. `ai-metadata.mjs` creates the text/JSON/crawler files from that exact measured
   view and the newly staged feature evidence
4. Vite/SvelteKit prerenders the site and copies the static files
5. `ai-metadata.mjs --check` compares **every generated output byte-for-byte**
   against the current inputs, failing the build if any file is missing or stale

The existing Pages workflow runs `just verify`, which reaches this build command
and additionally verifies static HTML discovery links and deployed raw evidence.
`check.yml` exercises the project-path build on pull requests. No deploy workflow
branch, extra credential, network generation call, or publishing step is added.
Deployments continue to use the existing workflow and permissions.

Generated files are ignored, never edited or checked in manually. Re-running the
same build inputs produces identical bytes: no wall-clock timestamp is inserted.
`latestEvidenceCollectedAt` is the maximum recorded collection time, not a claim
that old benchmarks were refreshed during deployment. The source view and feature
evidence SHA-256 values and per-shard SHA-256 values support provenance checks.

`BASE_PATH` is respected in **all** generated absolute URLs and HTML discovery
links, including the existing `/wasm.fyi` project-path test build. The canonical
origin lives in `src/lib/site.ts` and is shared by HTML and generated files. Change
that one constant if the public origin changes. Per-page canonical links omit
query/filter state; per-result report identity is retained in JSON.

## Validation

```sh
pnpm check
pnpm test
pnpm test:ai
pnpm build
node scripts/check-build.mjs
BASE_PATH=/wasm.fyi pnpm build
BASE_PATH=/wasm.fyi node scripts/check-build.mjs
```

`pnpm test:ai` covers zero vs null, missing coverage, reason index zero, intervals,
newest-failure handling, report provenance, URL escaping and base paths, corrupt
inputs, deterministic rendering, source changes and stale/missing output checks.
`just verify` also runs the existing evidence/adapter workflow tests. Native adapter
checks remain conditional on those benchmark toolchains being installed, as before.
