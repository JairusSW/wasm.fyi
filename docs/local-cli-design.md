> Implementation note: the initial source-installed CLI is now implemented.
> `wasmfyi --help` and README's Local CLI section describe available commands.
> This design also records future distribution and interactive-picker ideas;
> signed standalone releases, bundled Node downloads, and project TOML defaults
> are not part of the initial implementation.

# Local benchmark CLI

Status: proposed interface and implementation plan. Commands below are design
examples, not commands implemented by this document.

## Everyday workflow

```sh
wasmfyi bench \
  --engines wago-railshot,wazero-wazevo,wasmtime-cranelift \
  --corpora applications/image-blur,applications/audio-adpcm

wasmfyi serve -p 8788
```

`bench` resolves the selected sources, prepares only the necessary tools, runs the
selected workloads, and imports completed results into the local SQLite database.
If the local website is running, it refreshes automatically. Otherwise, after
capture finishes, `bench` starts a managed loopback preview and prints its URL.
No production connection or credentials are needed. `--no-serve` disables preview
startup for scripts and CI; it does not disable the database import.

`serve` explicitly serves the same local database in the foreground. If an
identical managed preview is already running, it prints that URL and exits.
`serve stop` stops only a preview owned by this CLI, after verifying process
identity. It cannot terminate a server started by another user or application.

No arguments to `wasmfyi` prints help. `wasmfyi bench` without engine selectors
uses configured defaults, or opens the selector when attached to a terminal.
Without defaults or a terminal, it reports a usage error rather than launching
all engines. The interactive selector displays engines, corpora, and a final
resolved plan; pressing Run executes that exact plan. Passing flags requires no
interactive confirmation.

## Terminal presentation

Follow the existing reference implementations:

- Wago: `cli/internal/command/help.go` and `cli/internal/ui/output.go`.
- W: `compiler/cmd/w/help.go`.

Use a short banner, `Usage:`, `Commands:`, `Flags:`, and `Examples:`; aligned
columns; bold headings; dim placeholders and secondary details; cyan completion;
and red `wasmfyi:` errors followed by dim `hint:` guidance. Do not add a logo,
ASCII art, an alternate full-screen shell, or constant spinners.

Style stdout and stderr independently. Color is enabled only for terminal output
and disabled by `NO_COLOR` or `TERM=dumb`. Redirected output is stable plain text.
Honor `wasmfyi -h`, `--help`, `help`, `<command> --help`, and `help <command>`.
Help and discovery must work without building adapters, opening a database,
fetching GitHub metadata, or starting a server.

### Root help

```text
wasmfyi — WebAssembly benchmarks on your machine

Usage: wasmfyi <command> [flags]

Commands:
  bench                 measure selected engines and corpora
  test                  check feature compatibility
  serve                 serve your local results
  engines               list engines, backends, and cached versions
  corpora               list workload selectors
  runs       [run]       show captures and progress
  resume     <run>       continue an interrupted capture
  stop       <run>       stop a capture at a workload boundary
  cache                 inspect or prune reusable build artifacts
  doctor                check this machine and selected toolchains
  version               show version information

Flags:
  --data <directory>     use another local dataset
  --json                 print machine-readable output
  --help, -h             show this help
  --version, -v          show version information

Use wasmfyi <command> --help for flags and examples.
```

No production deployment command in the initial CLI. Export/import and SSH
execution can be later commands without changing local benchmark semantics.
Existing publishing and maintenance commands remain available for deployment
scripts; this proposal does not remove the `/admin/v1/` publishing API.

### Benchmark help

```text
Usage: wasmfyi bench [flags]

Measure selected engines, then update your local website.

Flags:
  --engines, -e <ids>    engine/backend selectors; comma-separated or repeated
  --corpora, -c <ids>    workload selectors (default: main)
  --source <id=path>     snapshot a local runtime checkout; repeatable
  --id <name>           name this capture
  --rerun               take fresh samples instead of linking identical results
  --samples <n>         use fixed samples, subject to phase caps
  --timeout <duration>  maximum time per workload (default: 5m)
  --port, -p <port>      preview port (default: 8788)
  --no-serve            save results without starting a preview
  --offline             require cached sources, tools, and inputs
  --dry-run             print the resolved plan without building or measuring
  --help-sampling       explain sampling, limits, and recorded statistics
  --help, -h            show this help

Examples:
  wasmfyi bench -e wago-railshot,wazero-wazevo -c applications
  wasmfyi bench -e wasmtime-cranelift -c applications/image-blur
  wasmfyi bench -e wago-railshot --source wago-railshot=../../Wago/wago
```

The singular `--engine` and `--corpus` spellings are accepted aliases. Selectors
are unions, deduplicated after resolution. Unknown or empty selectors fail before
any SDK build starts. No silent fallback to a different backend or runtime.

### Discovery

```text
$ wasmfyi engines

Engine                  Backend       Cached  Source
wago-railshot           railshot      yes     beta.13 · <short hash>
wazero-wazevo           compiler      yes     <version> · <short hash>
wasmtime-cranelift      cranelift     no      <version>
wasmtime-winch          winch         no      <version>
wasmi                   interpreter   yes     2970aa871cc1
wasm3                   interpreter   yes     28ecb9af6d20
...
```

This is a shape example; versions are resolved from the real registry, not
hardcoded into help. `engines --all` shows the complete supported registry;
`engines <id>` shows source, feature policy, prerequisites, build availability,
and backend details. Discovery distinguishes cached, buildable, and unavailable
on this architecture. Unsupported architecture is not a guest workload failure.

`corpora` lists stable selectors and workload counts. `corpora applications`
expands that family; `corpora features` lists feature families and their
compatibility/performance inventory. Never require users to guess internal run
paths or hashes.

### Capture output

Illustrative values below are placeholders, not captured benchmark claims.

```text
$ wasmfyi bench -e wago-railshot,wazero-wazevo -c applications/image-blur

Run: local-20261103-191500
  Machine      Apple M4 Max · arm64
  Engines      wago-railshot, wazero-wazevo
  Corpora      applications/image-blur · 1 workload
  Sampling     adaptive groups of 5 · compile/instantiate ≤10 · execution ≤25
  Resources    phase peak RSS · native code when available

Preparing
  wago-railshot     cached
  wazero-wazevo     cached
  image-blur.wasm   cached

Measuring
  wago-railshot     1/1  ✓
  wazero-wazevo     1/1  ✓

Saved 2 workload results to local SQLite.
  Results      http://localhost:8788/benchmarks/?run=local-20261103-191500
  Resume       wasmfyi resume local-20261103-191500
```

Display updates replace a small progress region only on a terminal. Redirected
output emits bounded stage/workload lines. `--json` writes versioned JSONL events
and one final result object to stdout; human diagnostics go to stderr. The run
link must select that run's exact machine, configurations, source identities, and
workloads, not merely open the unfiltered homepage. This requires implementing
run selection in the website and API; `?run=` is a proposed contract.

Errors follow the reference style:

```text
wasmfyi: unknown engine "wazero-wavevo"
hint: did you mean "wazero-wazevo"? See wasmfyi engines.

wasmfyi: port 8788 is already in use
hint: results were saved. Run wasmfyi serve -p 8789.
```

## Engine and corpus identities

Public IDs identify a runtime plus backend: `wago-railshot`, `wazero-wazevo`,
`wasmtime-cranelift`, `wasmtime-winch`, `wasm2c-gcc`, and so on. Keep existing
internal database engine IDs; use a single registry to map public IDs to their
current bindings. For example, `wago-railshot` maps to engine `wago`,
`wazero-wazevo` to `wazero`, and `wasmtime-cranelift` to `wasmtime`.

Short aliases remain accepted when unambiguous. A family with multiple backends
must not silently choose one. List and help output always use canonical IDs.

Version suffixes are supported:

```sh
wasmfyi bench -e wago-railshot@beta.13,wasmtime-cranelift@main -c applications
wasmfyi bench -e wago-railshot@<commit> -c applications/image-blur
```

An unqualified engine resolves to its latest stable release, with Wago betas
included; use the default branch only when no eligible release exists. Explicit
`@main` resolves once to a full commit. Persist the resolved source and compiler
identity in the immutable run plan. `resume` never advances it. A normal new run
refreshes resolution metadata; `--offline` uses a cached resolution or fails.

`--source id=path` snapshots tracked modifications, untracked source inputs,
submodules, and relevant build inputs into a content-addressed source bundle.
Build the bundle; never mutate or reset the contributor's checkout. Record its
base commit and dirty-tree digest. Bundle only declared build inputs; respect
ignore rules and omit credentials, environment files, and unrelated untracked
files. Do not persist the full process environment or upload local source or
results.

Corpus selectors accept exact IDs and segment-bounded prefixes. `main` expands
the pinned main inventory; `applications` selects its application subset;
`applications/image-blur` selects that workload. A quoted glob is allowed only
if documented and resolved by the CLI, never by a shell subprocess.

Default `bench` scope is main performance only. `bench -c features/simd` selects
feature performance explicitly. `test -e ... -c features/simd` runs compatibility
with one sample. Feature performance uses matching compatibility results when
available; otherwise it first collects the selected feature's compatibility
prerequisites. Those cases are shown in the plan. A feature that fails its
required compatibility contracts cannot receive a valid feature performance
ranking. Do not run the entire feature suite for an application benchmark.

## Capture and serving behavior

- Prepare source/toolchain/frontend assets before timing. Fetch and verify only
  selected dependencies. Build SDKs on available cores; benchmark one engine
  and workload at a time on one measurement core.
- Use the shared host-lock protocol for timing batches. Yield at workload
  boundaries around 30 minutes and release before idle waits or server startup.
  Linux pins an admitted performance CPU. macOS uses available scheduling
  controls and reports that it cannot promise Linux-style CPU affinity.
- Retain current sampling defaults: one process, ordered groups of five, no
  warmups, compile/instantiate at most 10 samples and first/steady/call execution
  at most 25. Existing stability thresholds remain 5% relative standard deviation
  and 3% relative drift, with settling metadata retained. `--samples n` selects
  fixed sampling; each phase uses `min(n, phase cap)`, displayed before capture.
- Measure compile, instantiate, first call, steady execution, and available
  boundary-call workloads; capture phase RSS and native-code size without
  repeating deterministic resource observations for every timing sample.
  Retain only applicable metrics; an interpreter's native code is n/a.
- Transpiler compilation includes translation plus native compilation. Its build
  peak RSS is `max(transpiler, compiler)`. No invented zero for absent metrics.
- Reuse compiled modules inside the capture where the declared phase permits it.
  Cold compile samples still compile fresh; timed instantiation and execution
  cannot secretly include an artifact build.
- Check selected workload oracles outside the timed operation. No expensive
  unrelated conformance suite or execution-proof bundle is collected by default.
- Apply the five-minute workload deadline to the complete case, including child
  processes. Record failure/crash/timeout and continue to the next workload.
  Reap descendants on cancellation. Keep bounded failure logs, not full verbose
  logs for every success.
- Commit completed workload results incrementally to local SQLite. A killed run
  retains completed work; `resume` skips it and retries only interrupted work.
  Completed failure dispositions are terminal unless `--rerun` is explicit.
- An identical backend, full source/build identity, host, artifact, contract, and
  sampling policy links existing captures by default. It must never accidentally
  reuse the portable-dispatch Wasmi measurement for an auto-dispatch build.
- Source pins, workload selection, metrics, and sampling stay immutable within a
  run. A different selection creates a new run; `--rerun` creates fresh captures
  without deleting the prior run.

`serve -p 8788` binds `127.0.0.1` by default. `-p` requires a numeric port; it is
not a publish switch. Honor port zero for an OS-assigned port and print the
actual URL. Report a busy port without killing or commandeering another
process. Do not silently pick a different port when a user supplied one.

Local authentication bypass is allowed only for explicit local mode on loopback;
never inherit production OAuth secrets or disable authentication on a public
listener. Avoid external listening in the first local CLI iteration. Existing
production `--listen`, `--frontend`, and `--data` serve paths remain compatible.

Ship a frontend shell that fetches the selected local dataset through the Go API.
Never bake wasm.fyi's production measurements into a local contributor build.
Capture imports update the database revision, invalidate server summaries, and
trigger the website's existing revision refresh. No frontend rebuild, complete
sample download, or per-cell API request is needed after a capture.

If no preview is running, default `bench` starts the managed preview only after
timing ends. Its identity includes owner, executable, start time, data directory,
and listener; stop verifies those facts. If capture succeeds but preview startup
fails, preserve the completed capture and print an operational error plus the
exact `serve` command needed to recover.

## Local storage

Default to the operating system's per-user application data/cache locations.
`--data` overrides the dataset location. An optional repository `wasmfyi.json`
sets engine/corpus/port defaults; users need no configuration file for flag-based
runs. Explicit flags override project settings, then per-user settings, then
built-in defaults.

```text
<data>/
  benchmarks.sqlite       samples, observations, aggregates, run membership
  config.json             small local settings
  runtime/                owned preview identity and maintenance control

<cache>/
  sources/<digest>/       verified source bundles
  tools/<digest>/         selected SDKs and toolchains
  artifacts/<digest>/     Wasm and native build artifacts
  failures/<run>/         bounded failure diagnostics
```

Run plans, progress checkpoints, ordered samples, and run-to-observation links
belong in SQLite; do not introduce another tree of permanent JSON sample dumps.
Keep large build inputs in the content-addressed cache, not in SQLite blobs.
A run can reference shared observations without copying them. Database updates
must be transactional and browsing must remain available while capture results
are imported. Avoid independent in-memory caches that never see revision changes.

`cache` reports sizes and active references. `cache prune` removes unused build
artifacts, preserving databases, running jobs, retained source identities, and
any executable still needed for a resumable run. Never blanket-delete shared
Cargo/Go caches. Cache eviction cannot remove an in-flight dependency.

## Implementation plan

Extend the existing Go `wasmfyi` executable instead of introducing a second
user-facing binary. Keep CLI parsing/presentation separate from the local capture
coordinator. The coordinator is the deep module: callers provide a resolved plan
and consume progress/results; it owns preparation, safe cache reuse, timing,
checkpoints, import, and preview notification.

1. Add Wago/W-style help, engine alias resolution, selectors, dry-run output, and
   port/data handling. Preserve current production command behavior and flags.
2. Add the run-plan/progress/membership tables to the existing SQLite storage.
   Reuse the SDK builders, latency collector, scenario policy, current source
   policies, and capture importer through a versioned internal worker protocol.
   Initially package the required Node worker scripts and verified Node runtime;
   do not require contributors to reconstruct campaign directories manually.
3. Implement `bench`, `test`, `runs`, `resume`, and `stop` through this coordinator.
   Do not forward directly to the old `scripts/benchmark.mjs run` defaults: that
   path still exposes legacy multi-worker, launch, and deployment behavior.
4. Package the frontend with the CLI, implement the owned preview lifecycle and
   run-scoped website selection, and connect imports to revision invalidation.
5. Add bounded cache pruning and platform-aware prerequisite diagnostics. Retain
   existing internal publishing commands without exposing credentials in output.

Acceptance checks:

- Empty local data directory → select two engines and two corpora → one command
  prepares, captures, stores, serves, and prints a working run-filtered link.
- An already-running preview refreshes after import without restarting or
  rebuilding the frontend; its aggregate and detail requests remain on demand.
- Exact repeat links results; `--rerun` records fresh ordered samples.
- Interrupted preparation and capture resume without losing completed cases or
  changing pins. Five-minute timeouts reap workload descendants and continue.
- Mixed engines use the same selected corpus and no feature suite appears in a
  main-only run. Unsupported metrics remain distinguishable from failures.
- Cache keys distinguish backend, Wasmi dispatch mode, compiler flags, source
  changes, machine, corpus contract, and sample policy.
- A borrowed host lock waits without reserving a CPU; a live owner is never
  stolen. Preview lifetime does not hold the measurement lock.
- Native transpiler work is included in compilation latency and peak RSS.
- Tests exercise the public command interface with deterministic fake workers;
  a separately requested small real-engine smoke run qualifies integration.
- Help, invalid-argument hints, redirected output, JSONL, cancellation, and
  occupied ports have deterministic tests. No benchmark is run by this design.

Exit status: 0 for a completed command; 1 for operational failure (including
saved results whose requested preview could not start); 2 for usage errors;
3 for a completed capture containing actual workload failures. Unsupported or
not-applicable outcomes alone do not make a run fail. Ctrl-C checkpoints and
returns 130. Lock contention waits by default rather than appearing as success.
