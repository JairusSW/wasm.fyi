package sqldb

import (
	"context"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"github.com/JairusSW/wasm.fyi/service/internal/benchdb"
)

func canonicalMemoryPlatform(ctx context.Context, tx *sql.Tx, p benchdb.Platform) (benchdb.Platform, error) {
	if p.MemoryBytes != 0 {
		return p, nil
	}
	var count int
	var memory sql.NullInt64
	err := tx.QueryRowContext(ctx, `SELECT count(*),min(memory_bytes) FROM platforms WHERE os=? AND arch=? AND cpu=? AND cores=? AND kernel=? AND memory_bytes>0`, p.OS, p.Arch, p.CPU, p.Cores, p.Kernel).Scan(&count, &memory)
	if err == nil && count == 1 && memory.Valid {
		p.MemoryBytes = memory.Int64
	}
	return p, err
}

type PlatformMemoryRepair struct {
	OldDigest       string `json:"oldDigest"`
	CanonicalDigest string `json:"canonicalDigest"`
	LatestBindings  int    `json:"latestBindings"`
	HistoryBindings int    `json:"historyBindings"`
}

// RepairUnknownMemoryPlatforms joins only an unambiguous, otherwise identical
// host. Observations and ordered vectors are never deleted or rewritten.
func (s *Store) RepairUnknownMemoryPlatforms(ctx context.Context) ([]PlatformMemoryRepair, error) {
	s.write.Lock()
	defer s.write.Unlock()
	tx, err := s.writer.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `SELECT z.id,k.id,z.digest,k.digest FROM platforms z JOIN platforms k ON k.os=z.os AND k.arch=z.arch AND k.cpu=z.cpu AND k.cores=z.cores AND k.kernel=z.kernel AND k.memory_bytes>0 WHERE z.memory_bytes=0 AND (SELECT count(*) FROM platforms k2 WHERE k2.os=z.os AND k2.arch=z.arch AND k2.cpu=z.cpu AND k2.cores=z.cores AND k2.kernel=z.kernel AND k2.memory_bytes>0)=1`)
	if err != nil {
		return nil, err
	}
	type pair struct {
		old, new             int64
		oldDigest, newDigest []byte
	}
	pairs := []pair{}
	for rows.Next() {
		var p pair
		if err = rows.Scan(&p.old, &p.new, &p.oldDigest, &p.newDigest); err != nil {
			rows.Close()
			return nil, err
		}
		pairs = append(pairs, p)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	result := []PlatformMemoryRepair{}
	for _, p := range pairs {
		report := PlatformMemoryRepair{OldDigest: hex.EncodeToString(p.oldDigest), CanonicalDigest: hex.EncodeToString(p.newDigest)}
		// This platform is retired in this transaction. Remove its derived
		// summaries first: deleting bindings must not repeatedly recompute the
		// maximum timestamp of a shrinking reference set. Canonical summaries
		// remain live and are rebuilt below; rollback restores all these rows.
		for _, table := range []string{"platform_observations", "platform_totals"} {
			if _, err = tx.ExecContext(ctx, `DELETE FROM `+table+` WHERE platform_id=?`, p.old); err != nil {
				return nil, err
			}
		}
		for _, history := range []bool{true, false} {
			table := "latest"
			if history {
				table = "history"
			}
			q := `SELECT b.workload_id,cfg.engine_id,o.configuration_id,b.phase,b.observation_id,b.snapshot_id,w.name,e.name,o.phase,b.as_of FROM history b` + joins + `WHERE b.platform_id=?`
			if !history {
				q = `SELECT b.workload_id,b.engine_id,o.configuration_id,b.phase,b.observation_id,b.snapshot_id,w.name,e.name,o.phase,'' FROM latest b` + joins + `WHERE b.platform_id=?`
			}
			rr, e := tx.QueryContext(ctx, q, p.old)
			if e != nil {
				return nil, e
			}
			type row struct {
				workload, engine, cfg, obs     int64
				phase                          int
				snapshot                       sql.NullInt64
				workloadName, engineName, asof string
				phaseID                        int
			}
			list := []row{}
			for rr.Next() {
				var a row
				if e = rr.Scan(&a.workload, &a.engine, &a.cfg, &a.phase, &a.obs, &a.snapshot, &a.workloadName, &a.engineName, &a.phaseID, &a.asof); e != nil {
					rr.Close()
					return nil, e
				}
				list = append(list, a)
			}
			e = rr.Err()
			rr.Close()
			if e != nil {
				return nil, e
			}
			for _, a := range list {
				phase := phases[a.phaseID]
				next, e := loadBinding(ctx, tx, history, p.old, a.workloadName, a.engineName, phase, a.asof, a.cfg, false)
				if e != nil {
					return nil, e
				}
				old, e := loadBinding(ctx, tx, history, p.new, a.workloadName, a.engineName, phase, a.asof, a.cfg, false)
				replace := errors.Is(e, sql.ErrNoRows)
				if e != nil && !replace {
					return nil, e
				}
				if !replace {
					// Scalar metadata rejects most enrichment candidates before any
					// ordered vector is loaded. Equal-time code enrichment still
					// compares the exact original vectors through enrichment().
					canEnrich := func() (bool, error) {
						if !enrichment(old, next) {
							return false, nil
						}
						fullOld, err := loadBinding(ctx, tx, history, p.new, a.workloadName, a.engineName, phase, a.asof, a.cfg, true)
						if err != nil {
							return false, err
						}
						fullNext, err := loadBinding(ctx, tx, history, p.old, a.workloadName, a.engineName, phase, a.asof, a.cfg, true)
						if err != nil {
							return false, err
						}
						return enrichment(fullOld, fullNext), nil
					}
					if history {
						replace = later(next.CapturedAt, old.CapturedAt)
						if !replace {
							replace, e = canEnrich()
						}
					} else {
						ahead := false
						eligible := true
						if next.Source != nil && old.Source != nil {
							if qualified(next.Source) != qualified(old.Source) {
								eligible = qualified(next.Source)
								ahead = eligible
							} else if next.Source.AsOf != old.Source.AsOf {
								eligible = later(next.Source.AsOf, old.Source.AsOf)
								ahead = eligible
							}
						}
						replace = eligible && (ahead || later(next.CapturedAt, old.CapturedAt))
						if eligible && !replace {
							replace, e = canEnrich()
						}
					}
					if e != nil {
						return nil, e
					}
				}
				if replace {
					snapshot := any(nil)
					if a.snapshot.Valid {
						snapshot = a.snapshot.Int64
					}
					if history {
						_, e = tx.ExecContext(ctx, `INSERT INTO history(platform_id,workload_id,configuration_id,phase,as_of,observation_id,snapshot_id) VALUES(?,?,?,?,?,?,?) ON CONFLICT(platform_id,as_of,workload_id,configuration_id,phase) DO UPDATE SET observation_id=excluded.observation_id,snapshot_id=excluded.snapshot_id`, p.new, a.workload, a.cfg, a.phase, a.asof, a.obs, snapshot)
					} else {
						_, e = tx.ExecContext(ctx, `INSERT INTO latest(platform_id,workload_id,engine_id,phase,observation_id,snapshot_id) VALUES(?,?,?,?,?,?) ON CONFLICT(platform_id,workload_id,engine_id,phase) DO UPDATE SET observation_id=excluded.observation_id,snapshot_id=excluded.snapshot_id`, p.new, a.workload, a.engine, a.phase, a.obs, snapshot)
					}
					if e != nil {
						return nil, e
					}
				}
			}
			if history {
				report.HistoryBindings = len(list)
			} else {
				report.LatestBindings = len(list)
			}
			if _, e = tx.ExecContext(ctx, `DELETE FROM `+table+` WHERE platform_id=?`, p.old); e != nil {
				return nil, e
			}
		}
		oldKey := "imported/" + report.OldDigest
		newKey := "imported/" + report.CanonicalDigest
		var oldImported, newImported string
		if e := tx.QueryRowContext(ctx, `SELECT value FROM metadata WHERE key=?`, oldKey).Scan(&oldImported); e != nil && !errors.Is(e, sql.ErrNoRows) {
			return nil, e
		}
		if e := tx.QueryRowContext(ctx, `SELECT value FROM metadata WHERE key=?`, newKey).Scan(&newImported); e != nil && !errors.Is(e, sql.ErrNoRows) {
			return nil, e
		}
		if oldImported != "" && (newImported == "" || later(oldImported, newImported)) {
			if _, err = tx.ExecContext(ctx, `INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, newKey, oldImported); err != nil {
				return nil, err
			}
		}
		for _, table := range []string{"prepared", "platform_observations", "platform_totals"} {
			if _, err = tx.ExecContext(ctx, `DELETE FROM `+table+` WHERE platform_id=?`, p.old); err != nil {
				return nil, err
			}
		}
		if _, err = tx.ExecContext(ctx, `DELETE FROM platforms WHERE id=?`, p.old); err != nil {
			return nil, err
		}
		for _, key := range []string{oldKey, fmt.Sprint("revision/", p.old), fmt.Sprint("latest-revision/", p.old), fmt.Sprint("history-revision/", p.old)} {
			if _, err = tx.ExecContext(ctx, `DELETE FROM metadata WHERE key=?`, key); err != nil {
				return nil, err
			}
		}
		if _, err = tx.ExecContext(ctx, `INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)`, "platform-memory-repair/"+report.OldDigest, encode(struct {
			Report             PlatformMemoryRepair
			OriginalImportedAt string
		}{report, oldImported})); err != nil {
			return nil, err
		}

		// Rebuild this host's small materialized totals from canonical bindings.
		// Binding triggers already update them; this also verifies repaired copies.
		if _, err = tx.ExecContext(ctx, `DELETE FROM platform_observations WHERE platform_id=?`, p.new); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE platform_totals SET latest_rows=(SELECT count(*) FROM latest WHERE platform_id=?),history_rows=(SELECT count(*) FROM history WHERE platform_id=?),latest_samples=0,all_samples=0,captured_ns=NULL,captured_at=NULL WHERE platform_id=?`, p.new, p.new, p.new); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO platform_observations(platform_id,observation_id,latest_refs,history_refs) SELECT ?,observation_id,sum(l),sum(h) FROM (SELECT observation_id,1 l,0 h FROM latest WHERE platform_id=? UNION ALL SELECT observation_id,0 l,1 h FROM history WHERE platform_id=?) GROUP BY observation_id`, p.new, p.new, p.new); err != nil {
			return nil, err
		}
		for _, key := range []string{fmt.Sprint("latest-revision/", p.new), fmt.Sprint("history-revision/", p.new)} {
			if _, err = tx.ExecContext(ctx, `INSERT INTO metadata(key,value) VALUES(?,lower(hex(randomblob(32)))) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key); err != nil {
				return nil, err
			}
		}
		if err = bump(ctx, tx, p.new, encode(report)); err != nil {
			return nil, err
		}
		result = append(result, report)
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	if len(result) > 0 {
		s.invalidateAggregates()
	}
	return result, nil
}
