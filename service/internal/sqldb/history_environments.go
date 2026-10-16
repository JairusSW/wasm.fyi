package sqldb

// mergeHistorySnapshots selects one current source per engine across a host's
// environments. It keeps cells from that source, never averages duplicate
// captures, and leaves cached snapshots and their original metadata untouched.
func mergeHistorySnapshots(parts []*aggregateSnapshot) *aggregateSnapshot {
	if len(parts) == 1 {
		return parts[0]
	}
	out := &aggregateSnapshot{engines: map[string]*aggregateConfiguration{}}
	for _, part := range parts {
		for engine, cfg := range part.engines {
			old := out.engines[engine]
			if preferConfiguration(cfg, old) || (old != nil && cfg.key == old.key && cfg.passed && !old.passed) {
				out.engines[engine] = cfg
			}
		}
	}
	indices := map[string]int{}
	for _, part := range parts {
		for _, row := range part.rows {
			cfg := out.engines[row.cfg.engine]
			if cfg == nil || row.cfg.key != cfg.key {
				continue
			}
			row.cfg = cfg
			key := row.cfg.engine + "\x00" + row.workload + "\x00" + row.contract + "\x00" + row.phase
			if index, ok := indices[key]; ok {
				if later(row.capturedAt, out.rows[index].capturedAt) {
					out.rows[index] = row
				}
			} else {
				indices[key] = len(out.rows)
				out.rows = append(out.rows, row)
			}
		}
	}
	return out
}
