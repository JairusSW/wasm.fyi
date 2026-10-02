# Application corpus

The configured corpus contains **70 curated upstream workloads and 96 original CPU kernels: 166 distinct algorithms across 27 categories**, with 6–7 in each category. Every algorithm has one representative input. Larger input sizes, scalar/SIMD variants and repeated exports do not count as additional workloads. All selected contracts are importable; that does not mean every engine has passed them. Feature probes and official conformance suites remain separate from application execution averages.

The website lists prepared workloads without invented timings. Overnight collection supplies real measurements under matching artifact IDs and digests. The active selection filters application views and their aggregate cohorts; archived evidence remains intact.
## Coverage

| Category | Contracts | Importable |
| --- | ---: | ---: |
| 3D & rendering | 6 | 6 |
| Audio | 6 | 6 |
| Bioinformatics | 6 | 6 |
| Calls & memory | 7 | 7 |
| Compilers & development tools | 6 | 6 |
| Compression | 7 | 7 |
| Computer vision | 6 | 6 |
| Databases & analytics | 6 | 6 |
| Documents & layout | 6 | 6 |
| Files & directories | 6 | 6 |
| Games & physics | 6 | 6 |
| Geospatial | 6 | 6 |
| Graphics & images | 6 | 6 |
| Hardware design | 6 | 6 |
| Hashing & cryptography | 7 | 7 |
| Image editing | 6 | 6 |
| Integer & graph algorithms | 6 | 6 |
| JSON & serialization | 6 | 6 |
| Language runtimes | 6 | 6 |
| Linear algebra | 6 | 6 |
| Machine learning | 6 | 6 |
| Numerical arithmetic | 6 | 6 |
| Search & indexing | 6 | 6 |
| Statistics | 6 | 6 |
| Stencils | 6 | 6 |
| Text & parsing | 7 | 7 |
| Video processing | 6 | 6 |

Raw integer/floating-point computation, matrix algebra, stencils and scientific workloads come from the retained synthetic and PolyBench sets. Library workloads include JSON/Unicode/regex parsing, hashing, encryption, compression, SVG, image codecs, FFT and WAV decoding. Full application contracts include SQLite, jq, ripgrep, Clang, esbuild, Swift formatting, language interpreters, bioinformatics tools, coreutils, and FPGA tooling. Categories describe the measured work, independently of its source repository.

Original kernels fill the application gaps with distinct methods: image convolution, resizing, compositing, median filtering, dithering and color transforms; motion estimation, DCT, deblocking, denoising and optical flow; frustum culling, ray intersections, mesh skinning, Bezier tessellation and software rasterization. Other additions cover search algorithms, compiler passes, interpreters, compression, cryptography, graph traversal, databases, geospatial operations, DSP, machine learning, statistics, document layout and filesystem structures.

The explicit upstream selection lives in `corpora/selection.json`; original algorithms and independent references live in `scripts/lib/application-kernels.mjs` with C implementations in `corpora/applications/sources/kernels.c`. `corpus-audit` rejects duplicate algorithm identities and categories outside the 6–9 range. Original kernels target scalar Wasm MVP with automatic SIMD disabled. Rebuilds require `wasm-tools` and validate every artifact with all proposals disabled; LLVM’s implicit post-link `wasm-opt` pass is disabled to preserve that target. Descriptions identify the precise operation or substage rather than claiming whole-product coverage.

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

An explicit `WASMBENCH_CORPUS_IDS=tiny,...` upstream subset excludes the original kernels, preserving existing quick-check behavior. Add exact kernel contract IDs with `WASMBENCH_APPLICATION_IDS=applications/image-blur,...` when a mixed subset is wanted. Unknown or duplicate overrides fail rather than expanding silently.

## Correctness and provenance

Upstream import keeps the shared `corpus/catalog.json` artifact SHA-256, upstream revision/license/toolchain, fixtures, command stdout/stderr hashes, and exact/semantic memory oracles. Unsupported host contracts keep their reason and are never turned into a passing result. Unselected upstream entries with unavailable adapters are retained in the source catalogue, outside the curated workload list.

Original sources are MIT licensed under `corpora/applications/LICENSE`. `manifest.json` records compiler version/binary digest/flags, source digest, independent reference digest, deterministic input recipe, artifact digest, expected decimal-string result, reset policy, dimensions, and work units. Inputs and complete output checksums are part of the timed invocation. Integer/fixed-point outputs are exact; floating-point kernels use disabled contraction and quantized checksums verified against their independent references. JavaScript references are authored independently of emitted Wasm, and repeated invocations check that prior state does not affect output. LLVM auto-sizes initial linear memory to retained data; there is no imposed large allocation for kernels that need no buffers.

`corpora/catalog.json` is the checked-in inventory snapshot. The build publishes it at `/wasmbench/corpus-catalog.json`; it contains no benchmark timing values. `node scripts/corpus-audit.mjs --check` detects drift against the configured upstream checkout and original manifests. Source/artifact/reference digest guards run before combined collection; CI also checks every original contract without requiring the external source checkout.

## Boundaries

This is broad representative Wasm CPU/application coverage, not literally every possible Wasm use case. CPU image processing, geometry and software rendering do not measure WebGL/WebGPU or GPU drivers. File fixtures do not measure disk/network latency. DOM/UI integration, real network services, GPU compute, complete video codecs, speech recognition and font shaping require additional host-specific end-to-end suites. Video motion estimation, audio DSP and document layout are explicitly labeled kernels.
