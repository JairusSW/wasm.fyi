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

`GET /api/v1/overview?scope=<URL-encoded JSON>` uses the same explicit cohort
scope and returns small cards, unit/definition references, population counts and
policy explanations. It computes the complete selected population, shares the
bounded cohort cache and calculation admission, and links to paginated membership.
Each response resolves one revision; explicitly pinned scopes are immutable.
Trial evidence, recipes and report inventories are absent. Publication integrity,
producer source assertions and operator qualification remain separate fields.
No baseline or compatible method is selected implicitly. Popular overview presets
and publication-time precomputation remain pending.

`GET /api/v1/sessions/{id}?revision=...` reports the session's immutable plan/pin
bindings and counts of jobs published in that revision. `/sessions/{id}/jobs`
returns bounded pages of completed collection jobs, with small report and parent
bundle references. Cursors freeze publication state. The service currently
receives completed jobs; it does not have the full planned job inventory or live
worker states. Therefore planned-job count and full-session completeness are
explicitly null. Upload/abort details remain on authenticated admin endpoints.

`/api/v1/history` accepts `from` and `until` RFC3339 instants together. The window
is inclusive at `from` and exclusive at `until`, and spans at most 120 UTC month
buckets. Equivalent timezone representations normalize to the same cursor scope.
Published month indexes let a selected window skip older linked history objects;
older dataset revisions remain readable through a bounded fallback. Historical
evidence enrichment still resolves to the same capture.

For maintenance while serving, create a private directory (mode `0700`) and pass
`--control-socket /private/run/wasmfyi.sock` to `serve`. The optional local Unix
socket has mode `0600`; existing socket paths are rejected. Use
`wasmfyi backup --control /private/run/wasmfyi.sock --output /private/new-backup`
or `wasmfyi gc --control /private/run/wasmfyi.sock` (add `--apply` for cleanup).
These commands use the live database owner; they never open a second Pebble
instance. Network publisher credentials cannot call these operations. Maintenance
admits one request at a time, shares publication serialization and holds a shutdown
lease. Cleanup retains its 24-hour/7-day grace periods. Backup output must be a new
destination; relative CLI paths resolve on the caller before transmission.
Shutdown cancels requests and removes the owned socket. After an abrupt process
exit, operators must check that the old owner is gone before removing its stale
socket. Verify backups and exercise restore/rebuild before relying on them.
