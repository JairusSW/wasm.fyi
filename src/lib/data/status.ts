// Result status vocabulary. Missing data states stay distinct — never zero.
import type { Status } from './types';

export const ST: Record<Status, [glyph: string, label: string, color: string]> = { ok: ['✓', 'correct', 'var(--st-pass)'], unsupported: ['⊘', 'unsupported', 'var(--fg3)'], disabled: ['○', 'disabled', 'var(--fg3)'], failed: ['✕', 'failed', 'var(--st-fail)'], crashed: ['‼', 'crashed', 'var(--st-crash)'], timeout: ['◷', 'timed out', 'var(--st-warn)'], nm: ['–', 'not measured', 'var(--fg3)'], na: ['·', 'not applicable', 'var(--fg3)'], unavail: ['—', 'unavailable', 'var(--fg3)'] };
export const ST_DESC: Partial<Record<Status, string>> = {
 unsupported: 'This workload is unsupported by the measured configuration or adapter.',
 disabled: 'This capability is disabled in the measured configuration.',
 failed: 'The recorded workload result failed validation.',
 crashed: 'The recorded workload process terminated abnormally.',
 timeout: 'The workload exceeded its configured time limit.',
 nm: 'No measurement was recorded for this metric and configuration.',
 na: 'This metric does not apply to the configuration; interpreters emit no native code.',
 unavail: 'No usable value is available for the selected comparison.',
};

/** Translate wire statuses without exposing another display vocabulary. */
export function statusTuple(value:string|undefined,fallback:Status='nm') {
 const aliases:Record<string,Status>={'passed':'ok','not-measured':'nm','not-collected':'nm','not-applicable':'na','unavailable':'unavail'};
 const key=value&&(aliases[value]||(Object.hasOwn(ST,value)?value as Status:undefined));
 return ST[key||fallback];
}
