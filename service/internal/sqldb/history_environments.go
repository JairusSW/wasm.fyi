package sqldb

// mergeHistorySnapshots selects one current source per engine across a host's
// environments. Cells come from that source; a cell it has not measured yet
// falls back to the most recent earlier source (see latestAvailable). Duplicate
// captures are never averaged, and cached snapshots keep their original metadata.
func mergeHistorySnapshots(parts []*aggregateSnapshot) *aggregateSnapshot {
	if len(parts) == 1 {
		return parts[0]
	}
	out := &aggregateSnapshot{engines: map[string]*aggregateConfiguration{}}
	rows := []aggregateScalar{}
	for _, part := range parts {
		for engine, cfg := range part.engines {
			old := out.engines[engine]
			if preferConfiguration(cfg, old) || (old != nil && cfg.key == old.key && cfg.passed && !old.passed) {
				out.engines[engine] = cfg
			}
		}
		rows = append(rows, part.rows...)
		out.bytes += part.bytes
	}
	out.rows = latestAvailable(rows, out.engines)
	return out
}

// latestAvailable keeps one row per engine, workload and phase: the row from the
// engine's preferred configuration when it has one, otherwise the row from the
// most preferred configuration that measured it. A campaign that has re-measured
// only part of the corpus therefore never hides the remaining workloads. Rows
// are returned in input order; ties between equal configurations keep the
// latest capture, then the earliest input (the preferred environment).
func latestAvailable(rows []aggregateScalar, engines map[string]*aggregateConfiguration) []aggregateScalar {
	best := map[string]int{}
	order := []string{}
	for i, row := range rows {
		chosen := engines[row.cfg.engine]
		// A corrected V8 compiler identity supersedes the legacy optimizer label.
		if chosen != nil && row.cfg.engine == "v8" && chosen.backend == "turboshaft" && row.cfg.backend == "optimizing-only" {
			continue
		}
		key := row.cfg.engine + "\x00" + row.workload + "\x00" + row.phase
		j, ok := best[key]
		if !ok {
			best[key] = i
			order = append(order, key)
			continue
		}
		old := rows[j]
		if row.cfg.key != old.cfg.key {
			isChosen := func(c *aggregateConfiguration) bool { return chosen != nil && c.key == chosen.key }
			if isChosen(row.cfg) || !isChosen(old.cfg) && preferConfiguration(row.cfg, old.cfg) {
				best[key] = i
			}
		} else if later(row.capturedAt, old.capturedAt) {
			best[key] = i
		}
	}
	keep := make([]bool, len(rows))
	for _, key := range order {
		keep[best[key]] = true
	}
	out := make([]aggregateScalar, 0, len(order))
	for i, row := range rows {
		if keep[i] {
			// Share the selected configuration across environments.
			if chosen := engines[row.cfg.engine]; chosen != nil && chosen.key == row.cfg.key {
				row.cfg = chosen
			}
			out = append(out, row)
		}
	}
	return out
}
