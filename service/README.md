# wasm.fyi API service

Experimental Go/Pebble/local-content service for the existing collector. See the
[implementation checkpoint](../docs/api-data-v2-progress.md) for commands,
wire contracts, validation and remaining production gates.

The serving module imports no harness code and no SQLite. It does not execute
benchmarks, archived verifiers or on-demand native disassembly. The current
frontend is still served through the existing Pages workflow.

To host a fixed root-path SvelteKit build alongside the API, pass
`--frontend /absolute/path/to/build` to `wasmfyi serve`. The directory must contain
the adapter-static application shell `404.html`; missing or symlinked shells fail
startup. Known application routes use that shell rather than prerendered HTML.
Measured `/bench/...` workload routes resolve through the current revision's
index; missing workloads and assets return real 404s. Immutable `_app` assets
receive long-lived caching; navigation and other assets revalidate. Static reads
share the service's request limits and shutdown leases.

This flag supplies backend hosting, not the frontend data migration. The current
client still uses its bundled snapshot, so production cutover must wait for lazy
API-backed rendering and crawler/reference-page validation. Builds with a nonempty
`BASE_PATH` require matching proxy routing and are not handled by this root-path
host. Treat the build directory as immutable while the process is running.

`GET /api/v1/aggregates?scope=<URL-encoded JSON>` computes the whole selected
cohort and returns a small summary. The `CohortScope` contract is in
`schemas/site-v2.schema.json`. Scope policies explicitly select the environment,
current/previous measurements, tracks or exact configurations, producer method
and metric-definition digests, analysis version, weighting, workload population,
contract policy, mixed builds and recorded/missing collector handling.

The returned `cohort` identity is used at `GET /api/v1/cohorts/{id}` with optional
`limit`, `cursor` and `lane`. It freezes the revision, is signed with the durable
cursor key and reconstructs from stored summaries after cache loss or rebuild.
Membership pages contain exact result/report/configuration/contract/method
references and source values. Aggregates do not load trial evidence or invent
cross-report confidence intervals. Scope JSON is limited to 4 KiB; calculations
are bounded and admitted separately from ordinary API requests.
