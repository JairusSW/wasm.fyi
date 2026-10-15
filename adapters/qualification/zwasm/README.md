Zwasm uses its source-built C API with the requested backend forced and checked.

On Linux, the sampling process sets an 8 GiB `RLIMIT_DATA` by default. Repeated
GC allocation workloads can otherwise exhaust the entire benchmark host. The
engine reports allocation failure as a failed workload; it is never recorded as
unsupported or assigned a timing value. The effective limit is included in the
runtime configuration as `linux_data_limit_bytes`.

Set `WASMBENCH_ZWASM_DATA_LIMIT_BYTES` to another byte count, or `0` to disable
this guard. An existing lower process limit is preserved. This limit affects
only the sampling adapter, not SDK compilation. Other platforms default to zero
and do not claim that the Linux allocation limit is enforced.
