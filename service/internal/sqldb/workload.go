package sqldb

import "context"

// HasWorkload reports whether a workload has published current or historical measurements.
// Metadata left behind after removal does not turn a missing page into a 200.
// Use primary-key prefixes and the historical workload index, never samples.
func (s *Store) HasWorkload(ctx context.Context, workload string) (bool, error) {
	var found bool
	err := s.reader.QueryRowContext(ctx, `SELECT EXISTS (
		SELECT 1 FROM workloads w WHERE w.name=? AND (
			EXISTS (
				SELECT 1 FROM platforms p WHERE EXISTS (
					SELECT 1 FROM latest l WHERE l.platform_id=p.id AND l.workload_id=w.id
				)
			) OR EXISTS (SELECT 1 FROM history h WHERE h.workload_id=w.id)
		)
	)`, workload).Scan(&found)
	return found, err
}
