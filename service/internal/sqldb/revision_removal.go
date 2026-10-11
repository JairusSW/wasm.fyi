package sqldb

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/JairusSW/wasm.fyi/service/internal/benchdb"
	"strings"
)

type RevisionRemoval struct {
	Engine              string `json:"engine"`
	Revision            string `json:"revision"`
	LatestRemoved       int64  `json:"latestRemoved"`
	HistoryRemoved      int64  `json:"historyRemoved"`
	LatestRestored      int64  `json:"latestRestored"`
	ObservationsRemoved int64  `json:"observationsRemoved"`
}

func revisionBlocked(ctx context.Context, tx *sql.Tx, engine string, source *benchdb.Source) (bool, error) {
	if source == nil {
		return false, nil
	}
	var blocked bool
	err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM blocked_revisions WHERE engine=? AND revision=?)", engine, source.Revision).Scan(&blocked)
	return blocked, err
}

// RemoveRevision removes only this engine's uniquely resolved revision and durably
// blocks re-publication. Latest slots are restored from their remaining history.
func (s *Store) RemoveRevision(ctx context.Context, engine, prefix string) (RevisionRemoval, error) {
	out := RevisionRemoval{Engine: engine}
	if engine == "" || len(prefix) < 8 || len(prefix) > 64 || strings.Trim(prefix, "0123456789abcdef") != "" {
		return out, fmt.Errorf("engine and hexadecimal revision prefix (at least 8 characters) required")
	}
	s.write.Lock()
	defer s.write.Unlock()
	tx, err := s.writer.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `SELECT DISTINCT src.revision FROM observations o JOIN configurations c ON c.id=o.configuration_id JOIN engines e ON e.id=c.engine_id JOIN sources src ON src.id=o.source_id WHERE e.name=? AND substr(src.revision,1,?)=? UNION SELECT revision FROM blocked_revisions WHERE engine=? AND substr(revision,1,?)=?`, engine, len(prefix), prefix, engine, len(prefix), prefix)
	if err != nil {
		return out, err
	}
	var revisions []string
	for rows.Next() {
		var r string
		if err = rows.Scan(&r); err != nil {
			rows.Close()
			return out, err
		}
		revisions = append(revisions, r)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	if len(revisions) != 1 {
		return out, fmt.Errorf("revision prefix resolved to %d revisions; require exactly one", len(revisions))
	}
	out.Revision = revisions[0]
	statements := []string{
		`CREATE TEMP TABLE removal_observations AS SELECT o.id FROM observations o JOIN configurations c ON c.id=o.configuration_id JOIN engines e ON e.id=c.engine_id JOIN sources src ON src.id=o.source_id WHERE e.name=? AND src.revision=?`,
		`CREATE TEMP TABLE removal_slots AS SELECT platform_id,workload_id,engine_id,phase FROM latest WHERE observation_id IN(SELECT id FROM removal_observations)`,
		`CREATE TEMP TABLE removal_platforms AS SELECT platform_id FROM latest WHERE observation_id IN(SELECT id FROM removal_observations) UNION SELECT platform_id FROM history WHERE observation_id IN(SELECT id FROM removal_observations)`,
		`CREATE TEMP TABLE removal_samples AS SELECT DISTINCT samples_id AS id FROM observations WHERE id IN(SELECT id FROM removal_observations) AND samples_id IS NOT NULL`,
	}
	// Temp tables belong to the single writer connection and are removed before returning.
	defer func() {
		tx.Rollback()
		for _, n := range []string{"removal_observations", "removal_slots", "removal_platforms", "removal_samples"} {
			s.writer.Exec("DROP TABLE IF EXISTS temp." + n)
		}
	}()
	for i, q := range statements {
		var args []any
		if i == 0 {
			args = []any{engine, out.Revision}
		}
		if _, err = tx.ExecContext(ctx, q, args...); err != nil {
			return out, err
		}
	}
	if _, err = tx.ExecContext(ctx, `INSERT OR IGNORE INTO blocked_revisions(engine,revision) VALUES(?,?)`, engine, out.Revision); err != nil {
		return out, err
	}
	execCount := func(q string) (int64, error) {
		r, e := tx.ExecContext(ctx, q)
		if e != nil {
			return 0, e
		}
		return r.RowsAffected()
	}
	if out.LatestRemoved, err = execCount(`DELETE FROM latest WHERE observation_id IN(SELECT id FROM removal_observations)`); err != nil {
		return out, err
	}
	if out.HistoryRemoved, err = execCount(`DELETE FROM history WHERE observation_id IN(SELECT id FROM removal_observations)`); err != nil {
		return out, err
	}
	if out.LatestRestored, err = execCount(`WITH ranked AS (SELECT slot.platform_id,slot.workload_id,slot.engine_id,slot.phase,h.observation_id,h.snapshot_id,ROW_NUMBER() OVER(PARTITION BY slot.platform_id,slot.workload_id,slot.engine_id,slot.phase ORDER BY sn.qualified DESC,sn.as_of_ns DESC,o.captured_ns DESC,o.id DESC,h.snapshot_id DESC) AS rn FROM removal_slots slot JOIN history h ON h.platform_id=slot.platform_id AND h.workload_id=slot.workload_id AND h.phase=slot.phase JOIN configurations c ON c.id=h.configuration_id AND c.engine_id=slot.engine_id JOIN snapshots sn ON sn.id=h.snapshot_id JOIN observations o ON o.id=h.observation_id) INSERT INTO latest(platform_id,workload_id,engine_id,phase,observation_id,snapshot_id) SELECT platform_id,workload_id,engine_id,phase,observation_id,snapshot_id FROM ranked WHERE rn=1`); err != nil {
		return out, err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM platform_observations WHERE observation_id IN(SELECT id FROM removal_observations) AND latest_refs=0 AND history_refs=0`); err != nil {
		return out, err
	}
	if out.ObservationsRemoved, err = execCount(`DELETE FROM observations WHERE id IN(SELECT id FROM removal_observations) AND NOT EXISTS(SELECT 1 FROM latest WHERE observation_id=observations.id) AND NOT EXISTS(SELECT 1 FROM history WHERE observation_id=observations.id)`); err != nil {
		return out, err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM sample_vectors WHERE id IN(SELECT id FROM removal_samples) AND NOT EXISTS(SELECT 1 FROM observations WHERE samples_id=sample_vectors.id)`); err != nil {
		return out, err
	}
	if err = addBindings(ctx, tx, int(out.LatestRestored-out.LatestRemoved-out.HistoryRemoved)); err != nil {
		return out, err
	}
	rs, err := tx.QueryContext(ctx, `SELECT platform_id FROM removal_platforms`)
	if err != nil {
		return out, err
	}
	var platforms []int64
	for rs.Next() {
		var id int64
		if err = rs.Scan(&id); err != nil {
			rs.Close()
			return out, err
		}
		platforms = append(platforms, id)
	}
	err = rs.Err()
	rs.Close()
	if err != nil {
		return out, err
	}
	for _, pid := range platforms {
		if err = bump(ctx, tx, pid, encode(out)); err != nil {
			return out, err
		}
	}
	if err = tx.Commit(); err != nil {
		return out, err
	}
	s.invalidateAggregates()
	return out, nil
}
