# Updating and deploying wasm.fyi

The `justfile` is the entry point for local work and GitHub Actions. The original
visual layout, controls and styling are preserved. Displayed measurements come from
checksum-verified sealed reports; static raw evidence is published under
`wasmbench/`. [integration-audit.md](integration-audit.md) documents the view mapping
and the limits of each measurement.

The collector allows up to five minutes per trial, including adapter startup and
all samples. Large source-built modules can exceed the former 30-second limit
while completing successfully. Override this with `WASMBENCH_TIMEOUT`. The
default remains three samples for compilation, instantiation and steady execution,
and one for first call, memory and native code.

## Local website workflow

```sh
just                     # list commands
just setup               # install the frozen pnpm lockfile
just dev                 # local website
just verify              # TypeScript, tests, evidence validation, static build
just preview             # production build preview
```

Requires Node.js 26.4.0, pnpm 11.15.1 and just 1.58.0. Ordinary validation and builds
use checked-in snapshots; they do not require Go, Rust, runtime adapters or the
sibling harness checkout. `just pages-build` builds for `/wasm.fyi`; set `BASE_PATH`
when building for another project path. GitHub Actions obtains the actual base
path from the Pages configuration. Local links and programmatic navigation use
that prefix; directory-style prerendered URLs support static Pages hosting. Route names, visuals and interactions remain the same.

## Update from sealed reports

```sh
just update
# Or select specific report directories (paths with spaces work):
just update ../../Tools/wasm-bench/reports/extra-adapters-v2
```

The configured sources in `wasmbench.config.json` resolve relative to the harness
checkout. Explicit paths resolve relative to this repository. Source selection
replaces the snapshot index; it does not silently combine different experiments
into one runtime comparison.

`just update` acquires a lock, gathers into a temporary directory, verifies every
source with the current controller, validates the generated projection and its
raw-evidence digests, stages the static assets, runs app/workflow tests and checks,
and builds and verifies the website. On failure it restores the previous data,
static assets and build. Success writes `.wasmbench/update-summary.json` with the
index digest and run identities. Repeating an unchanged import produces the same
snapshot content; timestamps are taken from the experiment, not the import time.

`just gather` only gathers verified exports. `just data-check` validates their
schema, exact cohort identity, outcome counts, missing values and intervals,
index/evidence agreement and SHA-256 digests. `just stage` copies only the index
and referenced evidence into `static/wasmbench/`; the unverified research catalog
is not deployed. `just build` rejects prerender errors and confirms the built site
contains the current index and evidence bytes.

Gathering needs Go and the configured harness. `WASMBENCH_ROOT` overrides its
location; `WASMBENCH_BIN` selects a trusted current controller instead of `go run`.
Old configured reports marked `rebuild` are regenerated from sealed raw evidence
in a temporary directory. Their original reports are never overwritten.

## Collect and update with fresh measurements

On the measurement host, install the harness Go/Rust requirements and configure
`root`, `collection.runtimes`, `collection.wagoSource` and suite in
`wasmbench.config.json`. Then:

```sh
just bench-build         # build adapters and independent analyzer before measuring
just bench-doctor        # inspect host and adapter availability
just collect             # sealed experiment only; site data is unchanged
just hub-doctor          # SSH and Hub toolchain prerequisites
just refresh             # collect on Mac + Hub, validate both, then build
just refresh-local       # bounded Mac-only validation
```

Collection creates unique run IDs under `.wasmbench/experiments/`. It collects a
minimally instrumented timing pass, a separate matched memory pass, and an optional
code pass. Each bundle and final report is verified on its measurement host.
Local report imports verify the complete report seal; Hub exports are reduced to
the fields consumed by wasm.fyi after Hub verifies the full report. AMD64 and
ARM64 floating-point reductions can differ in their last bit, so each host's
sealed analysis and raw trial values remain associated with that host. The
website projection retains the digest of the original Hub report. The unique leaf names matter:
the harness indexes experiments by output directory name.

Default collection covers Wago/Railshot, wazero/compiler, Wasmtime/Cranelift,
Wasmtime/Winch and V8 using the Wago corpus, six independent launches, five batches,
one operation per batch and three retained warmup batches. These settings are
configuration, not claims about old snapshots. Memory runs use single-operation
batches; code uses a separate compile pass. Phase barriers default off because
not every selected scalar adapter/scenario supports them. Turn them on only for
a supported configuration/scenario; no timing headline can come from that pass.

For a bounded local validation or a different host configuration:

```sh
WASMBENCH_RUNTIMES=wazero,v8 WASMBENCH_LAUNCHES=3 \
WASMBENCH_SAMPLES=3 WASMBENCH_OPERATIONS=10 just refresh-local
```

Overrides also include `WASMBENCH_SUITE`, `WASMBENCH_WARMUP` and `WAGO_SOURCE`.
`just refresh` preserves up to `retention` snapshots (default 12), newest first,
with each report's host/configuration/workload identity intact. Complete run
archives remain outside Git under `.wasmbench/experiments/`; projected site
snapshots are checked in. Missing or failed measurements remain explicit.


The Mac coordinates both hosts. `hosts.hub.ssh` selects `hub@hub`; its workspace is
`~/.cache/wasm-fyi/`. `just collect-hub` copies shallow Git metadata plus tracked and unignored source files
from the Mac's harness and Wago checkouts into new experiment directories on Hub,
builds adapters there, collects all three passes, and copies sealed evidence back.
Existing Hub checkouts are untouched. Source HEAD and dirty status accompany the
archive. Toolchain and runtime build identities remain in the sealed evidence.
A persistent SSH control socket is reused during collection.
Successful Hub collections retain their complete sealed report on Hub and send a
wasm.fyi-only projection in a Zstandard-compressed tar archive. That projection
contains the measurements, summaries, and trial evidence consumed by the site;
large raw bundles and archived builders do not travel back to the Mac. The
controller verifies the archive digest and projection seal before importing it.
Failed or diagnostic collections continue to use the complete XZ evidence
archive so their raw files remain available for diagnosis.
Tailscale may require
interactive authentication; authenticate before enabling unattended updates. If
SSH access expires, the job fails and preserves the last published site.

`just refresh` updates data only after both hosts succeed. Each report retains its
architecture and host identity; Mac and Hub results are separate snapshots. Remote
archives remain on Hub and copied archives live under `.wasmbench/experiments/` on
the Mac. Remove old remote archives manually after retaining needed evidence.

## GitHub Pages deployment

`.github/workflows/deploy-pages.yml` runs on pushes to `main` and manual dispatch.
It installs the locked frontend tools, runs `just verify`, uploads `build/`, and
deploys it to the `github-pages` environment. `.github/workflows/check.yml` runs the
same validation for pull requests and other branches and saves a preview artifact.
All builds use checked-in data, so a hosted runner does not measure runtime speed.

Once the workflow is committed and GitHub Pages is configured to use GitHub
Actions, push to `main` or run:

```sh
just deploy              # dispatch deploy-pages.yml on main
just deploy some-branch  # dispatch a review branch explicitly
```

The default project URL is `https://jairussw.github.io/wasm.fyi/`. Custom-domain DNS
is separate from this workflow; a different base path is supplied automatically
when Pages is configured for a custom domain.

## Manual fresh-data automation

`.github/workflows/update-benchmarks.yml` is dispatched manually. There is no cron schedule. It runs only when `WASMBENCH_AUTOMATION_ENABLED=true`.
It requires a registered self-hosted runner with the `wasm-bench` label and the
configured harness/source checkouts. The selected runner is this Apple Silicon Mac, coordinating Hub over SSH.

Run `just runner-install` on this Apple Silicon Mac to register the `wasm-bench`
runner and install its user LaunchAgent. The installer verifies the official runner
archive checksum and installs GNU tar and XZ through Homebrew when needed for
Pages packaging and evidence transport; registration tokens are not written into the repository.
Install Node, pnpm, just, Go and Rust on the Mac, and Node, Go, Rust, rsync, tar and XZ on Hub.
The runner account must be able to read the harness and Wago source directories.
The Mac must be awake with the runner user logged in, and Hub must be reachable.
The LaunchAgent starts at login; `just runner-status` checks its local service.
Enable automation from that host's site checkout:

```sh
just automation-status
just automation-enable   # requires an online wasm-bench runner; records checkout paths
just automate            # request an immediate fresh-data update and deployment
just automation-check    # same corpus/hosts/deployment, bounded 3-launch validation
just automation-disable  # pause scheduled collection; ordinary deployments still work
```

`automation-enable` sets repository variables `WASMBENCH_ROOT`, `WAGO_SOURCE` and
`WASMBENCH_AUTOMATION_ENABLED`. Running it from another machine would record that
machine's paths, so run it on the measurement host. The status command lists runners
and configuration. `automate` fails immediately if no suitable runner is online
instead of leaving a workflow waiting for an unavailable host.

The refresh job builds tools before measuring, collects new sealed passes, runs
`just refresh`, commits only `data/wasmbench` and `static/wasmbench` to `main`, then
deploys the validated artifact directly to Pages. It does not force-push, merge a
PR, edit the UI or update unrelated files. A concurrent main-branch change rejects
the push and stops deployment. All Pages jobs share a concurrency group. Manual dispatch accepts explicit
launch/sample/operation/warmup overrides, recorded in each run. Daily jobs use the
configured defaults; `automation-check` uses three launches, one batch, one operation
and one warmup batch to validate the entire path. Complete
sealed experiment archives are retained as Actions artifacts for 14 days, including
failed runs when any evidence exists. Failures stop the update and deployment.
Branch protections must permit this updater's normal push to `main`; if they do
not, the refresh fails rather than bypassing them.

The workflow token explicitly grants contents write for the data commit and Pages
write/OIDC for deployment. The refresh workflow itself deploys the artifact, so it
does not depend on another workflow being triggered by a token-authenticated push.

## Verification and recovery

```sh
just data-check
just verify
gh run list --workflow deploy-pages.yml
gh run list --workflow update-benchmarks.yml
```

A failed local update restores prior bytes. A failed automation job preserves the
last deployed site. Full experiment evidence remains in the local archive or its
Actions artifact. To restore an older published snapshot selection, revert its
data commit and push to `main`; normal Pages validation/deployment runs again.

A hard process termination can leave `.wasmbench/update.lock` or `refresh.lock`.
The files record their owner PID. Check that the process has stopped before
removing a stale lock. Do not delete immutable experiment archives to retry a
failed collection; the next collection creates fresh IDs.

Workflow syntax, scheduling and permissions follow the
[GitHub Actions documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).

## Corpus selection and source builds

The default application corpus selects **65 executable Wago benchmarks**, expanded by
`import-wago` into **72 exact workload contracts**. It includes all 30 PolyBench/C
kernels, 12 hand-written/compute benchmarks, six AssemblyScript variants and 17
semantic library benchmarks: hashing, compression, image/audio processing, JSON,
UTF, regular expressions and numerical code. Selection lives in
`wasmbench.config.json`; artifacts and inputs must match Wago's catalog digests.
All exported entry points retain their upstream arguments, initialization, reset
rules and exact return/memory oracles. Unknown licenses remain explicit rather
than inheriting a repository license by assumption.

```sh
just corpus-prepare      # import selection and record coverage/provenance
just corpus-check        # verify all selected runtime/workload result contracts
just corpus-build        # rebuild seven Wago WAT workloads in an isolated directory
just corpus-source-check # rebuild and check the exact results across runtimes
```

`corpus-build` requires `wat2wasm`. It copies source into
`.wasmbench/source-builds/`, records compiler version, source/artifact SHA-256 and
exact build argv, and emits a separate `source/wago/...` suite. The original Wago
checkout, catalog and artifacts stay intact. The generated manifest path is saved
in `.wasmbench/latest-source-suite.txt`; use its absolute path as `WASMBENCH_SUITE`
with `just refresh-local` to measure rebuilt variants. Source-suite overrides are
local; the manual dual-host workflow imports the configured Wago catalog on each
host from the same copied source snapshot.

Wago also has source recipes under `corpus/build/` for Rust compute kernels,
AssemblyScript and PolyBench/C. PolyBench's recipe pins its upstream Git commit
and uses WASI SDK Clang. Run additional builds in an isolated checkout, record
compiler/source/flags and new artifact digests, and admit them only with exact
oracles. Rebuilding is an explicit corpus change; manual measurements reuse pinned
artifacts so toolchain changes do not silently change the comparison.

The ARM64 Winch policy explicitly disables SIMD because its native lowering is
incomplete for these workloads. The five AssemblyScript SIMD export cells remain
visible as unsupported for that backend; the other selected runtimes execute
those same contracts. The harness capability fix is recorded in `patches/winch-arm64-simd.patch`.
`just bench-build` applies it to `adapters/wasmtime/src/features.rs` in the
configured sibling harness if needed; already-applied patches are skipped. A
patch that no longer matches stops the build for review. Hub receives the same
source and patch. AMD64 Winch retains SIMD support. `patches/code-preflight.patch` also fixes the
code-profile sacrificial preflight to validate behavior using the timing adapter
profile; unavailable vector code extraction then stays unsupported instead of
blocking collection with a false preflight error. Both fixes are applied by
`just bench-build` and copied to Hub.

Real workloads use one operation per batch, five batches and six independent
launches by default; the earlier tiny core-suite setting of 100 operations per
batch is unsuitable for the broader algorithms. Every fresh pass still runs its
own sacrificial correctness preflight. Unsupported outcomes get no timing credit;
incorrect results, crashes and unexpected errors stop the update.

The manual refresh includes the original feature corpus, released-engine proposal configurations, real worker measurements and official conformance suites. Historical measurement is a manual catch-up: each run plans every missed Saturday in the latest four months, pins the default branch as the dimmed mainline, and also pins every eligible release in that window as a bold point. Wago betas, WAVM prereleases/tags, and stable releases for other engines are eligible. Incomplete historical runners remain explicit gaps. See [feature and history workflow](features-and-history.md) for commands, JSON endpoints, collection scopes, failure handling and historical interpretation. Snapshot inventory schema 2 keeps full evidence in separate hashed files; summary and evidence digests must both be checked by consumers.

### V8 compiler tiers

Headline V8 results use Node's production-default tiering. Optional forced-tier
experiments stay out of the main benchmark comparison.
The optimizing mode uses `--no-liftoff`; the baseline uses `--liftoff-only`.
Both include `--allow-natives-syntax` for a separate calibration module whose
export is inspected before its first call. Calibration does not inspect every
workload function, disable internal code caching, or prove background completion.
V8's optimizing-tier inspection intrinsic retains the legacy name
`%IsTurboFanFunction`; the pinned modern Wasm pipeline is Turboshaft.

`wasmbench.config.json` pins Node 26.4.0 / V8 14.6.202.34-node.21 on both hosts.
Collection rejects a different release, incorrect flags or a contradictory
calibration result. Hub installs the SHA-256-verified Linux archive into its
private measurement toolchain; its system Node is untouched. The Mac automation
uses the same exact Node release through `actions/setup-node`.

V8 feature collection uses Node's production-default tiering without experimental
feature flags. Shared-memory worker scaling runs its 32 defined cases in separate
processes with inherited worker flags. Execution means still exclude feature workloads.

History retains the eight measured Wago revisions, using the freshly collected
locked V8 configurations as a fixed current comparison baseline. Previous
production-tiered V8 measurements are retained as sealed evidence and never
relabeled as locked tiers.

These builds do not establish an interpreter tier: `--wasm-jitless` still yielded
Liftoff on the calibration export. An accepted flag is insufficient evidence of
DrumBrake availability. V8's current Wasm tiers are documented in its
[architecture guide](https://github.com/v8/v8/blob/main/docs/wasm/architecture.md).

Verified imports are retained at `.wasmbench/verified-inputs` before downstream
checks. Retry validation after a frontend fix with
`node scripts/update-data.mjs --append --dataset .wasmbench/verified-inputs`.
The retry verifies every cached digest and uses the same transactional installation
and rollback. Rebuilds discard each temporary report after its projection is
verified; original sealed evidence remains intact.

The complete feature corpus now includes Wasmi, WasmEdge, wasm3, WAMR,
Chicory, SpiderMonkey and Deno on both hosts, plus WAVM and JavaScriptCore on
macOS. `just features-adapters` provisions checksum-pinned isolated SDKs and
shells before building; `just features-adapter-test` verifies real lifecycle
calls, fresh-instance resets, changed artifact digests, incorrect scalar
oracles and incorrect memory oracles. `just features-collect` and
`just features-collect-hub` run every size and variant through separate timing,
RSS and code passes. The manual refresh includes these configurations automatically.

`just evidence-deduplicate` shares storage for byte-identical large files in
completed sealed experiments. It preserves every evidence path and checksum;
keep these archives immutable because identical files can share an inode. The
manual refresh runs this step before importing reports.

Pinned tools are WasmEdge 0.17.1, wasm3 0.5.0, WAMR 2.4.5, Chicory 1.7.5,
SpiderMonkey 143.0 and Deno 2.9.7. Wasmi is pinned by the harness Cargo lock.
The SDK cache is under `~/.local/share/wasm-fyi/toolchains/features-v1-<platform>`;
its manifest verifies every installed file before collection. macOS needs
Homebrew OpenJDK 25, or `WASMBENCH_JAVA` pointing to a Java/Javac/Jar installation
supporting Java 21. Hub uses its installed Java 21. A selected WAVM SDK must
already exist at `WASMBENCH_WAVM_SDK` or
`~/.local/share/wasm-fyi/toolchains/wavm-nightly-2026-04-05/sdk`. WAVM is included
in the default benchmark collection using prerelease `nightly-2026-04-05`
(source commit `4e82bb9`); set `WASMBENCH_WAVM_SDK` and
`WASMBENCH_WAVM_VERSION` only when selecting a different installed build.
No alternative engine is substituted for an unavailable platform configuration.

WAMR uses the classic interpreter with GC and exception handling enabled.
Its hardware stack guard is disabled to avoid a reproduced clash with Rust's
macOS guard pages; software stack checks remain. Instantiation selects a 1 MiB
Wasm stack and zero host-managed application heap, preserving the module's
initial memory size (the C API's default heap changed the memory.grow oracle
from 2 to 3 pages). Its compilation window includes C-API store creation and
module loading/validation. WasmEdge's compile window is loading/validation,
and Chicory's is parsing/validation. These are not native code generation.
Chicory includes export lookup and integer marshalling in call timers; JVM JIT,
allocation and garbage collection remain uncontrolled. All exact scalar and
memory oracles run outside measured intervals. wasm3 cannot provide a separate
instantiation window or fresh-instance steady execution under its borrowed
module/runtime contract; those cells remain adapter-unsupported.

The feature pages use separate feature configurations, including async
components. These configurations never become participants
in application leaderboards or history averages. A feature support cell requires
one recorded configuration to pass the full representative family; partial,
rejected/failed and adapter-unsupported cases retain their own diagnostics.
Adapter limitations do not imply that an engine lacks a feature. Shell builds
are distinct from Chrome, Firefox and Safari releases; browser release histories
remain uncollected. Wago's Canonical ABI, resources and experimental async
support remain documented plugin availability until those plugin configurations
have been measured.

Primary interfaces and build recipes:
[WAMR build configuration](https://github.com/wasm-micro-runtime/wasm-micro-runtime/blob/WAMR-2.4.5/doc/build_wamr.md),
[WAMR C API](https://github.com/wasm-micro-runtime/wasm-micro-runtime/blob/WAMR-2.4.5/core/iwasm/include/wasm_c_api.h),
[Chicory embedding](https://chicory.dev/docs/),
[WasmEdge release assets](https://github.com/WasmEdge/WasmEdge/releases/tag/0.17.1),
[Mozilla release shells](https://archive.mozilla.org/pub/firefox/releases/143.0/jsshell/).
