// Result status vocabulary. Missing data states stay distinct — never zero.
import type { Status } from './types';

export const ST: Record<Status, [glyph: string, label: string, color: string]> = { ok: ['✓', 'correct', 'var(--st-pass)'], unsupported: ['⊘', 'unsupported', 'var(--fg3)'], disabled: ['○', 'disabled', 'var(--fg3)'], failed: ['✕', 'failed', 'var(--st-fail)'], crashed: ['‼', 'crashed', 'var(--st-crash)'], timeout: ['◷', 'timed out', 'var(--st-warn)'], nm: ['–', 'not measured', 'var(--fg3)'], na: ['·', 'not applicable', 'var(--fg3)'], unavail: ['—', 'unavailable', 'var(--fg3)'] };
export const ST_DESC: Partial<Record<Status, string>> = {
  unsupported: 'Workload requires a feature this configuration does not implement (per feature-meta v14). Not run; excluded from aggregates.',
  disabled: 'Feature is available behind a flag; this snapshot runs runtime defaults. A flagged run exists as a separate configuration.',
  failed: 'Ran to completion but output checksum did not match the reference.\nexpected sha256 9f2c…a41e\nactual   sha256 3b07…c9d2\nNo performance credit given.',
  crashed: 'Process terminated abnormally.\nSIGSEGV in generated code (exit 139) during iteration 3.\nCore dump retained in run record.',
  timeout: 'Exceeded the 120 s compilation limit (killed at 120.0 s wall).\nReported as a failure at this size; see Scaling laboratory.',
  nm: 'Workload runs correctly (checksum ✓) but no measurement adapter exists for this metric/configuration pair. Not the same as unsupported.',
  na: 'Metric does not apply: an interpreter emits no native code. Shown as n/a, never as zero.',
  unavail: 'Configuration is not available on the selected machine.',
};
