# Updating and deploying wasm.fyi

The `justfile` is the entry point for local work and GitHub Actions. The original
visual layout, controls and styling are preserved. Displayed measurements come from
checksum-verified sealed reports; static raw evidence is published under
`wasmbench/`. [integration-audit.md](integration-audit.md) documents the view mapping
and the limits of each measurement.

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
code pass. Each bundle and final report is verified on its measurement host. Fresh imports
verify the original archive seal and regenerate the derived report with the Mac
controller before final verification. AMD64 and ARM64 floating-point reductions
can differ in their last bit; raw trials and host identities stay unchanged.
The export retains both the original report digest and the regenerated digest. The unique leaf names matter:
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
Evidence travels in an XZ-compressed tar archive: identical files are hard-linked in
an owned transport copy, so repeated runtime executables are stored once. Original
experiment files stay intact. The controller verifies the archive digest, restores
all paths, and then verifies the report seal and each raw bundle.
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

## Daily fresh-data automation

`.github/workflows/update-benchmarks.yml` is scheduled daily at **03:17 UTC**, and
can be dispatched manually. It runs only when `WASMBENCH_AUTOMATION_ENABLED=true`.
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

The default daily corpus selects **65 executable Wago benchmarks**, expanded by
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
local; the daily dual-host workflow imports the configured Wago catalog on each
host from the same copied source snapshot.

Wago also has source recipes under `corpus/build/` for Rust compute kernels,
AssemblyScript and PolyBench/C. PolyBench's recipe pins its upstream Git commit
and uses WASI SDK Clang. Run additional builds in an isolated checkout, record
compiler/source/flags and new artifact digests, and admit them only with exact
oracles. Rebuilding is an explicit corpus change; daily measurements reuse pinned
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

The daily refresh now includes the original feature corpus, explicit proposal configurations, and real shared-memory worker measurements. Thursday's additional schedule rebuilds eight retrospective weekly Wago revisions. See [feature and history workflow](features-and-history.md) for commands, JSON endpoints, collection scopes, failure handling and historical interpretation. Snapshot inventory schema 2 keeps full evidence in separate hashed files; summary and evidence digests must both be checked by consumers.
