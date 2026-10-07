set positional-arguments := true
set shell := ["bash", "-euo", "pipefail", "-c"]

# Show the website workflow.
default:
    @just --list

# Install the exact frontend dependency set.
setup:
    pnpm install --frozen-lockfile

# Start the original site locally.
dev:
    pnpm dev

# Run the website and API behind loopback-only Caddy at http://localhost:8080.
dev-caddy:
    bash scripts/dev-caddy.sh

# Check Svelte and TypeScript.
check:
    pnpm check

# Test frontend logic and the snapshot workflow.
test:
    pnpm test
    pnpm test:ai
    node --test scripts/weekly-retire.test.mjs scripts/lib/weekly-parity.test.mjs scripts/lib/weekly-calendar.test.mjs scripts/lib/benchmark-plan.test.mjs scripts/lib/corpus-collection.test.mjs scripts/benchmark-workflow.test.mjs scripts/plugin-evidence.test.mjs scripts/retention.test.mjs scripts/release-policy.test.mjs scripts/weekly-history.test.mjs scripts/workflow.test.mjs scripts/application-corpus.test.mjs scripts/corpus-v8.test.mjs scripts/upstream-sources.test.mjs scripts/corpus-build-all.test.mjs scripts/source-build-toolchains.test.mjs scripts/corpus-native-ports.test.mjs scripts/corpus-source-manifest.test.mjs scripts/feature-adapter.test.mjs scripts/wasmer-adapter.test.mjs scripts/v8-preflight.test.mjs scripts/lib/feature-configurations.test.mjs scripts/extra-feature-adapters.test.mjs scripts/command-input.test.mjs scripts/verify-seal.test.mjs scripts/collection-recovery.test.mjs

# Validate gathered snapshots and their raw evidence.
integration-audit:
    node scripts/integration-audit.mjs

wasmer-preflight:
    node scripts/wasmer-preflight.mjs local

wasmer-preflight-hub:
    node scripts/wasmer-preflight.mjs hub

wasmer-sdk-build:
    node scripts/wasmer-sdk.mjs

# Provision isolated LLVM 22.1 and the pinned native SDK on Hub.
wasmer-sdk-build-hub:
    node scripts/wasmer-sdk.mjs hub

# Build explicit compiler adapters and test real lifecycle/reset behavior.
wasmer-adapters:
    node scripts/wasmer-adapters.mjs

data-check:
    node scripts/check-data.mjs

# Gather and verify sealed reports; omit paths to use wasmbench.config.json.
gather *reports:
    node scripts/import-wasmbench.mjs "$@"

# Expose checked-in snapshots as static website JSON assets.
stage: data-check
    node scripts/stage-data.mjs

# Build and verify the static site, including all evidence assets.
build: data-check
    node scripts/build-site.mjs

# Full verification without requiring a benchmark checkout.
verify: check test build

# Gather, validate and build; roll back dataset, static evidence and build on failure.
update *reports:
    node scripts/update-data.mjs "$@"

# Check the measurement host and available adapters.
bench-doctor:
    node scripts/bench.mjs doctor

# Build adapters and the independent analyzer before measuring.
bench-build:
    node scripts/bench.mjs build

# Collect a new sealed timing/memory/code experiment without updating the site.
collect:
    node scripts/bench.mjs collect

# Finish memory/code passes from verified timing, preserving exact engine identities.
collect-resume timing:
    node scripts/resume-collection.mjs {{quote(timing)}}

# Collect on the Mac and Hub, retain snapshots, validate and build.
refresh:
    node scripts/refresh-data.mjs

# Serve the verified production build.
preview:
    pnpm preview --host 127.0.0.1

# Build with GitHub Pages project-path routing.
pages-build:
    BASE_PATH="/wasm.fyi" just build

# Deploy the committed branch through the GitHub Pages workflow.
deploy ref="main":
    gh workflow run deploy-pages.yml --ref {{quote(ref)}}

# Start an immediate refresh on the registered wasm-bench runner.
automate:
    node scripts/automation.mjs run

# Show registered measurement runners and automation variables.
automation-status:
    node scripts/automation.mjs status

# Enable manual collection after registering an online wasm-bench runner.
automation-enable:
    node scripts/automation.mjs enable

# Disable manual collection without changing ordinary site deployments.
automation-disable:
    node scripts/automation.mjs disable

# Check SSH and benchmark prerequisites on Hub.
hub-doctor:
    node scripts/hub.mjs doctor

# Collect on Hub using isolated copies of the Mac source checkouts.
collect-hub:
    node scripts/hub.mjs collect

# Refresh only the Mac snapshot for a local validation.
refresh-local:
    node scripts/refresh-data.mjs --local

# Install and start this Mac's GitHub Actions measurement runner.
runner-install:
    node scripts/runner.mjs install

runner-status:
    node scripts/runner.mjs status

# Import the configured Wago benchmarks with pinned artifacts and exact oracles.
corpus-prepare:
    node scripts/bench.mjs corpus

# Check result contracts across every selected runtime before timing.
corpus-check:
    node scripts/bench.mjs corpus-check

# Build every application, library, kernel and feature artifact from source.
corpus-build *args:
    node scripts/benchmark.mjs build-corpus "$@"

corpus-build-all:
    node scripts/corpus-build-all.mjs

# Rebuild only the retained WAT subset.
corpus-wat-build:
    node scripts/corpus-source.mjs

# Build from source and verify each rebuilt contract across selected runtimes.
corpus-source-check:
    node scripts/corpus-source.mjs --check

# Exercise both hosts and Pages deployment with a bounded three-launch collection.
automation-check:
    node scripts/automation.mjs check

# Rebuild the original feature corpus with the pinned compiler and WASI adapter.
features-build:
    node scripts/feature-corpus.mjs build

# Run attributed positive conformance checks separately from execution timing.
features-curation-check:
    node --test scripts/feature-curation.test.mjs scripts/feature-upstream-v8.test.mjs
    node scripts/feature-curation-check.mjs --require-all
    node scripts/feature-upstream-spec.mjs --require-all
    node corpora/features/upstream/runner-regression.mjs
    node scripts/feature-upstream-v8.mjs --require-all
    node scripts/feature-upstream-components.mjs --require-all

# Prepare an execution-only input suite for wasm-bench --scenarios steady.
features-execution-suite:
    node scripts/feature-execution-suite.mjs

# Execute exact feature oracles across all configured runtimes.
features-check: features-adapters
    node scripts/feature-corpus.mjs check

# Collect every feature size and variant on this Mac.
features-collect: features-adapters
    WASMBENCH_SUITE="corpora/features/manifest.json" WASMBENCH_VALIDATION_PROFILE=all WASMBENCH_WARMUP=0 WASMBENCH_RECORD_FAILURES=1 node scripts/bench.mjs collect

# Collect every feature size and variant on Hub.
features-collect-hub:
    WASMBENCH_SUITE="corpora/features/manifest.json" WASMBENCH_VALIDATION_PROFILE=all WASMBENCH_WARMUP=0 WASMBENCH_RECORD_FAILURES=1 node scripts/hub.mjs collect

# Resolve every engine to the release published by each Saturday cutoff.
history-plan:
    node scripts/history.mjs plan

# Queue the full corpus once per distinct Saturday/release and measurement recipe.
history-performance-plan:
    node scripts/performance-history.mjs plan

# Collect release-specific historical evidence under the host measurement lock.
history-performance-collect:
    node scripts/performance-history-collect.mjs

# Collect released-engine official-suite history; unimplemented runners remain explicit gaps.
history-collect:
    node scripts/history.mjs collect

# Backfill released-engine history on Hub, then retrieve verified reports.
history-collect-hub:
    node scripts/hub.mjs history

# Run all 32 shared-memory contention and worker-scaling cases with default V8 tiering.
threads-collect:
    node scripts/thread-workers.mjs

threads-collect-hub:
    node scripts/hub.mjs threads

# Verify corpus digests and independent proposal-admission behavior.
features-test:
    WASMBENCH_REQUIRE_ADAPTER_TESTS=1 node --test scripts/feature-adapter.test.mjs

# Install pinned SDKs/shells and build every platform feature configuration.
features-adapters:
    WASMBENCH_SUITE="corpora/features/manifest.json" node scripts/bench.mjs build

# Refresh current comparison engines without rerunning historical Wago binaries.
history-baseline:
    node scripts/history-baseline.mjs

# Verify native feature lifecycles, reset semantics, digest guards and exact oracles.
features-adapter-test: features-adapters
    WASMBENCH_REQUIRE_EXTRA_FEATURE_TESTS=1 node --test scripts/extra-feature-adapters.test.mjs scripts/command-input.test.mjs scripts/verify-seal.test.mjs scripts/collection-recovery.test.mjs

# Preserve sealed source evidence while sharing storage for identical archived files.
evidence-deduplicate:
    node scripts/deduplicate-evidence.mjs

# Inspect the pinned official core, WASI and Component Model suites.
conformance-plan:
    node scripts/conformance.mjs plan

# Run official suites against isolated published engine releases.
conformance-collect:
    node scripts/conformance.mjs collect

# Publish sealed official-suite reports, including failed and skipped tests.
conformance-publish *reports:
    node scripts/publish-conformance.mjs "$@"

conformance-collect-hub:
    node scripts/hub.mjs conformance

# Run released WASI/Component Model correctness suites on Mac and Hub concurrently.
wago-plugin-tests:
    node scripts/wago-plugin-tests.mjs

# Rebuild the original application kernels with pinned LLVM and reference checks.
applications-build:
    node scripts/application-corpus.mjs build

# Check every application algorithm in V8 and Wasmtime without collecting timings.
applications-check:
    node scripts/application-corpus.mjs check

# Audit the complete application inventory, contracts and use-case coverage.
corpus-audit:
    node scripts/corpus-audit.mjs

# Check the full configured corpus in pinned V8; components remain explicit gaps.
corpus-v8-check:
    node scripts/corpus-v8.mjs

# Check self-contained application/feature fixtures without upstream checkouts.
corpus-v8-local-check:
    node scripts/corpus-v8.mjs --local

# Refresh retained upstream source/build/fixture files from the configured checkout.
corpus-sources-refresh:
    node scripts/upstream-sources.mjs

# Capture each cached corpus, retain resumable state, and update the local site.
bench *args:
    node scripts/benchmark.mjs run "$@"

bench-resume id:
    node scripts/benchmark.mjs resume {{quote(id)}}

bench-status *ids:
    node scripts/benchmark.mjs status "$@"

bench-stop id:
    node scripts/benchmark.mjs stop {{quote(id)}}

# Cache existing Wasm and fixtures without rebuilding them.
corpus-cache *args:
    node scripts/benchmark.mjs cache "$@"

bench-test:
    node --test scripts/weekly-retire.test.mjs scripts/lib/weekly-parity.test.mjs scripts/lib/weekly-calendar.test.mjs scripts/lib/benchmark-plan.test.mjs scripts/lib/corpus-collection.test.mjs scripts/benchmark-workflow.test.mjs

# Archive retained results without source checkouts or build caches.
bench-export id output:
    node scripts/benchmark-export.mjs {{quote(id)}} {{quote(output)}}

# Resolve one Saturday 11:59 PM Eastern snapshot for both ARM64 and AMD64.
history-week-plan date:
    node scripts/weekly-plan.mjs {{quote(date)}}

# Inspect or stop the independently advancing historical backfill.
bench-history-status:
    node scripts/weekly-background.mjs status

bench-history-stop:
    node scripts/weekly-background.mjs stop
