# Feature performance workloads

Correctness probes and performance workloads have separate inventories. The
small source fixtures remain in `corpora/features/manifest.json`. Build the
long execution variants with `just features-performance-build`; their source,
artifacts, recipes and manifest are written to `.wasmbench/feature-performance/`.
`node scripts/feature-execution-suite.mjs` prepares those long contracts for
steady execution.

Each performance workload keeps its original feature tag. Stateless core
kernels repeat 64 times inside Wasm, return a checked i32 checksum, and report
the full number of feature operations per invocation. Component execution uses
65,536 operations per fresh invocation. Every engine receives the same artifact
and input; duration calibration changes only the number of measured invocations.

The GC allocation kernels retain all objects from the last inner invocation in
an observable root array. Exports expose the root count, stored values and object
identities. This prevents immediate allocation/access fusion from turning an
allocation benchmark into scalar arithmetic. The measurements include maintaining
those GC roots; they are not allocation-only instruction timings.

One-shot allocation/destructive contracts remain lifecycle probes. Function/type,
initializer and async-component probes remain compilation/instantiation probes.
The builder emits `lifecycle-probes.json` and `compile-probes.json` separately;
these do not enter the steady execution average.

The compact collector requires at least 50 ms in every retained steady sample,
uses seven warmup batches, and takes at least three independent launches.
Each launch keeps the configured number of samples (normally five). Short
calibration runs are discarded. An adapter that forces fresh instances must have
a sufficiently large source workload; it cannot silently satisfy the duration
requirement by ignoring a requested batch size. Unsupported proposals remain
unsupported.

`just features-performance-probe <plan.json>` exercises actual runtime adapters.
A saved plan supplies adapter commands, environments, exact workloads, host lock
root and output path. The probe records raw samples, per-launch sample deviation,
launch identity and duration qualification. Linux measurements use one CPU;
macOS uses taskpolicy priority. The shared machine lock excludes SDK builds and
other measurements. The empirical validation used Wago beta.12 and V8 through
Node v26.11.1 on the AMD Ryzen 7800X3D.

Assess variation between independent launches as well as variation within a
launch. Long batches improve measurement resolution but do not guarantee identical
runtime behavior across processes. Report the actual launch range/deviation;
do not discard slower launches or present batch averages as per-operation
latency distributions. These checks do not establish portability to unmeasured
engines or machines.
