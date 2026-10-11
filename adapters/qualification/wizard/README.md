# Wizard SDK adapter

The performance integration embeds the JSON-line protocol directly in the
source-pinned Wizard SDK through `scripts/prepare-wizard-benchmark.mjs`.
`buildWizardSDK` compiles that SDK with Virgil commit
`7cf038fc13a5474836bec8b14c7a3e796fd07fa5` and records compiler/artifact hashes and
measurement patches in the build receipt.

| Configuration | SDK mode | Host target | Native image |
|---|---|---|---|
| `wizard-v3-int` | `v3-int` | JVM | n/a |
| `wizard-fast-int` | `int` | Linux AMD64 | n/a |
| `wizard-spc` | `spc` | Linux AMD64 | emitted module image |

The native SDK build supplies both fast-interpreter and Singlepass commands.
History shares that build for the same commit; portable interpretation has a
separate build. Unavailable architecture/backend combinations receive an
explicit unsupported record.

Phase boundaries are SDK parse/validation and selected eager compiler,
fresh SDK linking/instantiation including a start function, and `Execute.call`
for first-call/steady execution. Export lookup, typed argument conversion,
input writes and independent scalar/memory/vector checks happen outside the
measured clocks. The last verified compile sample is retained for subsequent
phases. Stateless steady instances and decoded vector payloads persist across
sample groups; requests execute exactly their requested guest calls with zero
warmups.

The native adapter reads a full 64-bit Linux `CLOCK_MONOTONIC` timespec. Virgil's
native `System.ticksNs()` uses fractional `gettimeofday` microseconds: short
calls can measure zero, and the fractional second wraps each second. The JVM
adapter extends the SDK's wrapping 32-bit `nanoTime` value with its monotonic
microsecond reference for the five-minute workload deadline.

Singlepass code inspection reads actual `X86_64SpcModuleCode.codeEnd`, including
emitted module alignment/data and excluding unused mapping ballast and shared
runtime/interpreter stubs. It performs one cold compile and independent oracle
check. Interpreters return explicit unavailability with null bytes.

Source `399357ce20b8330ddc1888a93cceb0d4cf3762de` was checked on Apple ARM64
(portable interpreter) and Hub AMD64 (all three configurations) with the original
tiny/add and BLAKE3 vector artifacts: one sample per latency phase, no warmups,
and one code inspection. Hub Singlepass produced 160 and 45,116 image bytes
respectively; interpreter images were unavailable. These integration checks
write no benchmark database rows. The real controller build, JVM artifact/launcher tests, and resolved-command
SDK startup qualification passed on Hub for all three configurations on
2026-10-09; the coherent recipe is active on all three campaign machines.

The older Python `adapter.py`/`driver.py` files provide execution-only corpus
qualification with a linked independent oracle. Their subprocess duration is
an execution check and is never a phase-latency measurement.
