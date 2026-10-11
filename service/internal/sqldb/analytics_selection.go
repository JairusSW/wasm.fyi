package sqldb

import (
	"context"
	"database/sql"
	"errors"
)

// AnalyticsSelectionKnown validates optional dashboard dimensions against the
// existing indexed catalog without writing benchmark data. Arbitrary request
// query values are never retained as workload/runtime labels.
func (s *Store) AnalyticsSelectionKnown(ctx context.Context, kind, value string) (bool, error) {
	table := ""
	switch kind {
	case "runtime":
		table = "engines"
	case "workload":
		table = "workloads"
	default:
		return false, nil
	}
	var id int64
	err := s.reader.QueryRowContext(ctx, "SELECT id FROM "+table+" WHERE name=?", value).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}
