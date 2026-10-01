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

# Check Svelte and TypeScript.
check:
    pnpm check

# Test frontend logic and the snapshot workflow.
test:
    pnpm test
    node --test scripts/workflow.test.mjs

# Validate gathered snapshots and their raw evidence.
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

# Enable daily collection after registering an online wasm-bench runner.
automation-enable:
    node scripts/automation.mjs enable

# Disable daily collection without changing ordinary site deployments.
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
