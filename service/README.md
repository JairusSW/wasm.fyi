# wasm.fyi API service

Experimental Go/Pebble/local-content service for the existing collector. See the
[implementation checkpoint](../docs/api-data-v2-progress.md) for commands,
wire contracts, validation and remaining production gates.

The serving module imports no harness code and no SQLite. It does not execute
benchmarks, archived verifiers or on-demand native disassembly. The current
frontend is still served through the existing Pages workflow.
