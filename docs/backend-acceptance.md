# Backend completion audit

Goal: finish the backend described in the API/data v2 plan with verified scientific
fidelity, bounded serving work, crash-safe publication and recoverable operations.
Frontend migration is a separate consumer; backend completion does not mean merely
passing the existing synthetic fixture tests.

| Requirement | Current evidence / remaining work |
| --- | --- |
| Verified producer, legacy compatibility, full producer identities | Basic exporter verified; exporter identity and broader evidence closure pending |
| Bounded inventories and evidence, binary and inspection availability | Small JSON chunks implemented; scalable inventories/native export pending |
| Exact metric/profile/collector/denominator/method identity | Source registry retained; complete selector and compatibility policies pending |
| Completed-job unit, immutable plans, attempts, parent bundles, resume | Sink and immutable session/member/attempt bindings tested; archive resources and broader resume/attempt fixtures pending |
| Durable files before synchronous publication, hidden staging IDs | Abrupt subprocess exits verified at five publication stages; ENOSPC hooks, corrupt/missing data and durable retries tested; physical host disk exhaustion is not claimed |
| Reusable revision indexes and bounded query CPU/memory | Persistent dimension/kind indexes, bounded catalog pages and request cancellation tested; query caching, large-inventory scale and time-window indexing pending |
| Summary, catalog, session/job, report and artifact APIs | Initial endpoints implemented; full contract and query validation pending |
| Multi-report cohorts, coverage, weighting, memory populations | Producer summaries retained; site-policy parity and backend comparison endpoints pending |
| Exact historical contracts, builds, roles, reused evidence | Raw result history implemented; retrospective policies/windowing pending |
| Safe admin ingress, quotas, diagnostics, no benchmark/SQLite closure | Strict JSON, declared-object upload permits, pending/count/content quotas, import status/abort, safe errors and dependency closure tested; per-caller rate limits and broader ingress fuzz/scale gates pending |
| Portable rebuild, consistent backup, verified restore, conservative cleanup | Detached checkpoints, content-complete restore/DB-free rebuild, active-import-aware marking, two-phase grace/quarantine cleanup and crash recovery tested; online backup/maintenance leases and larger retention/scale gates pending |
| Static serving, application routes, real asset 404s, crawler references | Pending backend hosting integration |
| Observability, readiness, graceful shutdown, durable cursor secret | Graceful shutdown, durable cursor key, offline backup/gc CLI, TLS guard, readiness and authenticated storage/compaction metrics implemented; online operations and additional operational telemetry pending |
| Published producer packaging/pins | Local commits only; no production pin or deployment claim |

Completion requires current-state evidence for each row, including representative
sealed producer fixtures, source-preserving conversions, scale tests and actual
subprocess failures. Update this audit as evidence changes; keep unresolved rows
explicit. Never infer methodological parity from storage tests alone.
