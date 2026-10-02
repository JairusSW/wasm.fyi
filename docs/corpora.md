# Application corpus

The configured corpus contains **125 upstream benchmarks plus 14 original CPU kernels at three sizes each: 174 executable-contract entries across 27 categories**. There are 155 importable contracts and 19 explicit adapter gaps. Importable means the harness can express the contract; it does not mean every engine has passed it. Feature probes and official conformance suites remain separate from application execution averages.

The website lists prepared workloads immediately, with no timing values. Overnight collection supplies real measurements under the same artifact IDs and digests. Existing measurements retain their sealed evidence and matched cohorts; new inventory entries cannot change a measured aggregate.

## Coverage

| Category | Contracts | Importable |
| --- | ---: | ---: |
| 3D & rendering | 7 | 7 |
| Audio | 5 | 5 |
| Bioinformatics | 6 | 6 |
| Calls & memory | 7 | 7 |
| Compilers & development tools | 4 | 4 |
| Compression | 11 | 10 |
| Computer vision | 3 | 3 |
| Databases & analytics | 4 | 4 |
| Documents & layout | 3 | 3 |
| Files & directories | 2 | 1 |
| Games & physics | 6 | 6 |
| Geospatial | 3 | 3 |
| Graphics & images | 6 | 4 |
| Hardware design | 10 | 7 |
| Hashing & cryptography | 16 | 13 |
| Image editing | 9 | 9 |
| Integer & graph algorithms | 5 | 4 |
| JSON & serialization | 8 | 7 |
| Language runtimes | 9 | 4 |
| Linear algebra | 21 | 20 |
| Machine learning | 3 | 3 |
| Numerical arithmetic | 1 | 1 |
| Search & indexing | 1 | 1 |
| Statistics | 2 | 2 |
| Stencils | 6 | 6 |
| Text & parsing | 13 | 12 |
| Video processing | 3 | 3 |

Raw integer/floating-point computation, matrix algebra, stencils and scientific workloads come from the retained synthetic and PolyBench sets. Library workloads include JSON/Unicode/regex parsing, hashing, encryption, compression, SVG, image codecs, FFT and WAV decoding. Full application contracts include SQLite, jq, ripgrep, Clang, esbuild, Swift formatting, language interpreters, bioinformatics tools, coreutils, and FPGA tooling. Categories describe the measured work, independently of its source repository.

Original kernels fill the application gaps: Gaussian blur, bilinear resize, alpha compositing, Sobel vision, video block motion estimation, four-bone mesh skinning, software triangle rasterization with depth testing, particle simulation, grid pathfinding, quantized inference, FIR audio, columnar aggregation, document line layout, and map geometry classification. Each has small/medium/large dimensions and an explicit work unit. They target the scalar Wasm MVP instruction set with automatic SIMD disabled, so proposal support does not determine inclusion. They are portable CPU kernels, not claims about entire products.

## Reproduction and collection

```sh
just applications-build   # LLVM Clang 22.1.8; deterministic Wasm rebuild
just applications-check   # independent JS oracle + repeated V8 + Wasmtime
just corpus-audit         # verifies upstream artifacts/inputs and records inventory
just corpus-prepare       # combined application suite consumed by both hosts
just corpus-check         # all configured runtimes; correctness, not published timings
just refresh              # full Mac + Hub measurement/import/build workflow
```

Large collection is intentionally manual. Nothing schedules a daily run. `just refresh` uses the combined suite on both hosts; the existing Wednesday release-history workflow remains separate. Do not publish correctness-check duration as performance.

Set `WASMBENCH_CLANG` to a Linux/macOS LLVM 22.1.8 executable when it is not at the default Homebrew path. Compiler distributions can emit different Wasm despite sharing a version number; use the recorded compiler binary digest and artifact digest when reproducing a build. Both measurement hosts consume the same checked-in artifacts rather than rebuilding separately. Compiled artifacts are checked in, so ordinary collection, CI and deployment do not need LLVM. A rebuild stages a new directory, validates it, and only then replaces the prior corpus. Failed staging is retained under `.wasmbench` for diagnosis.

For a bounded application-only check, select the checked-in manifest:

```sh
WASMBENCH_SUITE=corpora/applications/manifest.json just corpus-check
```

An explicit `WASMBENCH_CORPUS_IDS=tiny,...` upstream subset excludes the original kernels, preserving existing quick-check behavior. Add exact kernel contract IDs with `WASMBENCH_APPLICATION_IDS=applications/image-blur/64,...` when a mixed subset is wanted. Unknown or duplicate overrides fail rather than expanding silently.

## Correctness and provenance

Upstream import keeps the shared `corpus/catalog.json` artifact SHA-256, upstream revision/license/toolchain, fixtures, command stdout/stderr hashes, and exact/semantic memory oracles. Unsupported host contracts keep their reason and are never turned into a passing result. Some language/application entries require export-return or specialized command adapters that are not yet available.

Original sources are MIT licensed under `corpora/applications/LICENSE`. `manifest.json` records compiler version/binary digest/flags, source digest, independent reference digest, deterministic input recipe, artifact digest, expected decimal-string result, reset policy, dimensions, and work units. Inputs and complete output checksums are part of the timed invocation. Integer/fixed-point arithmetic makes outputs exact across engines; existing upstream workloads separately cover floating-point math. JavaScript references are authored independently of emitted Wasm, and repeated invocations check that prior state does not affect output. LLVM auto-sizes initial linear memory to retained data; there is no imposed large allocation for kernels that need no buffers.

`corpora/catalog.json` is the checked-in inventory snapshot. The build publishes it at `/wasmbench/corpus-catalog.json`; it contains no benchmark timing values. `node scripts/corpus-audit.mjs --check` detects drift against the configured upstream checkout and original manifests. Source/artifact/reference digest guards run before combined collection; CI also checks every original contract without requiring the external source checkout.

## Boundaries

This is broad representative Wasm CPU/application coverage, not literally every possible Wasm use case. CPU image processing, geometry and software rendering do not measure WebGL/WebGPU or GPU drivers. File fixtures do not measure disk/network latency. DOM/UI integration, real network services, GPU compute, complete video codecs, speech recognition and font shaping require additional host-specific end-to-end suites. Video motion estimation, audio DSP and document layout are explicitly labeled kernels.
