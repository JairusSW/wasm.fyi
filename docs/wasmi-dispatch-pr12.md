# Wasmi dispatch check for PR #12

The ARM64 comparison used Wasmi 2.0.0, whose packaged source revision is
`2970aa871cc1001b57b267ccecdcd1e42306199e`, matching the current campaign pin.
Only the dispatch feature changed: `portable-dispatch` versus `auto-dispatch`.
Both used release optimization level 3, the same default codegen-unit/LTO settings,
eager compilation, no fuel, and the same memory64/SIMD and proposal settings.

Six fresh process pairs alternated A/B order. Each process loaded the same eight
committed application artifacts and recorded five ordered execution calls per
workload, verifying each scalar checksum outside the timed call. Values below
are medians of process medians; no samples or launches were discarded.

| Workload | Portable (µs) | Auto (µs) | Speedup |
| --- | ---: | ---: | ---: |
| image-blur | 5427.9 | 900.9 | 6.02x |
| audio-adpcm | 753.2 | 133.8 | 5.63x |
| numeric-integer-sqrt | 1821.4 | 499.9 | 3.64x |
| ml-convolution | 1457.2 | 259.2 | 5.62x |
| db-btree | 509.4 | 101.4 | 5.02x |
| vision-dilation | 3268.7 | 480.6 | 6.80x |
| bio-kmer-count | 1117.7 | 205.1 | 5.45x |
| mesh-skinning | 1369.3 | 185.0 | 7.40x |

The geometric mean speedup across this subset was 5.59x. Every workload improved
in every pair. The first pair showed larger clock/startup effects on several
workloads. This is a dispatch regression check, not a replacement for full corpus
captures or published timings. The Mac was on AC power; process/power audit,
binary hashes and raw samples remain in the ignored local directory
`.wasmfyi/local/wasmi-dispatch-pr12/`.

PR #12 updates fresh harness patches. The follow-up updates weekly bindings,
records the selected dispatch accurately, and migrates exact previous patches
without resetting unrelated source edits. Older SDKs without auto-dispatch keep
the supported portable backend. Existing published observations are retained.
