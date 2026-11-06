package sqldb

import (
	"bytes"
	"compress/gzip"
	"context"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/benchdb"
)

// Local runs reference normalized observations; samples are never copied into a
// second run archive. These tables are also safe to open on a serving database.
func (s *Store) EnsureLocalRuns(ctx context.Context) error {
	s.write.Lock()
	defer s.write.Unlock()
	_, err := s.writer.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS local_runs(id TEXT PRIMARY KEY,created TEXT NOT NULL,updated TEXT NOT NULL,status TEXT NOT NULL,plan BLOB NOT NULL,error TEXT NOT NULL DEFAULT '') WITHOUT ROWID;
 CREATE TABLE IF NOT EXISTS local_run_jobs(run_id TEXT NOT NULL REFERENCES local_runs(id) ON DELETE CASCADE,job_key TEXT NOT NULL,cache_key TEXT NOT NULL,status TEXT NOT NULL,PRIMARY KEY(run_id,job_key)) WITHOUT ROWID;
 CREATE INDEX IF NOT EXISTS local_job_cache ON local_run_jobs(cache_key,status);
 CREATE TABLE IF NOT EXISTS local_run_observations(run_id TEXT NOT NULL,job_key TEXT NOT NULL,observation_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,platform_id INTEGER NOT NULL REFERENCES platforms(id),PRIMARY KEY(run_id,job_key,observation_id),FOREIGN KEY(run_id,job_key) REFERENCES local_run_jobs(run_id,job_key) ON DELETE CASCADE) WITHOUT ROWID;`)
	return err
}

type LocalRun struct {
	ID        string          `json:"id"`
	Created   string          `json:"created"`
	Updated   string          `json:"updated"`
	Status    string          `json:"status"`
	Plan      json.RawMessage `json:"plan"`
	Error     string          `json:"error,omitempty"`
	Completed int             `json:"completed"`
}

func (s *Store) CreateLocalRun(ctx context.Context, id string, plan []byte) error {
	if len(id) == 0 || len(id) > 100 || !json.Valid(plan) || len(plan) > 8<<20 {
		return fmt.Errorf("invalid local run plan")
	}
	var packed bytes.Buffer
	z := gzip.NewWriter(&packed)
	if _, err := z.Write(plan); err != nil {
		return err
	}
	if err := z.Close(); err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err := s.writer.ExecContext(ctx, "INSERT INTO local_runs(id,created,updated,status,plan) VALUES(?,?,?,'planned',?)", id, now, now, packed.Bytes())
	return err
}
func (s *Store) LocalRun(ctx context.Context, id string) (LocalRun, error) {
	var r LocalRun
	var packed []byte
	err := s.reader.QueryRowContext(ctx, "SELECT id,created,updated,status,plan,error,(SELECT count(*) FROM local_run_jobs WHERE run_id=local_runs.id AND status='completed') FROM local_runs WHERE id=?", id).Scan(&r.ID, &r.Created, &r.Updated, &r.Status, &packed, &r.Error, &r.Completed)
	if err != nil {
		return r, err
	}
	z, err := gzip.NewReader(bytes.NewReader(packed))
	if err != nil {
		return r, err
	}
	defer z.Close()
	r.Plan, err = io.ReadAll(io.LimitReader(z, 8<<20+1))
	if len(r.Plan) > 8<<20 {
		return r, fmt.Errorf("local plan exceeds limit")
	}
	return r, err
}
func (s *Store) LocalRuns(ctx context.Context) ([]LocalRun, error) {
	rows, err := s.reader.QueryContext(ctx, "SELECT id,created,updated,status,error,(SELECT count(*) FROM local_run_jobs WHERE run_id=local_runs.id AND status='completed') FROM local_runs ORDER BY created DESC LIMIT 100")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []LocalRun{}
	for rows.Next() {
		var r LocalRun
		if err := rows.Scan(&r.ID, &r.Created, &r.Updated, &r.Status, &r.Error, &r.Completed); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
func (s *Store) SetLocalRunStatus(ctx context.Context, id, status, message string) error {
	if status != "running" && status != "paused" && status != "completed" && status != "failed" {
		return fmt.Errorf("invalid run status")
	}
	_, err := s.writer.ExecContext(ctx, "UPDATE local_runs SET status=?,error=?,updated=? WHERE id=?", status, message, time.Now().UTC().Format(time.RFC3339Nano), id)
	return err
}
func (s *Store) LocalJobDone(ctx context.Context, run, key string) (bool, error) {
	var ok bool
	err := s.reader.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM local_run_jobs j WHERE run_id=? AND job_key=? AND status='completed' AND EXISTS(SELECT 1 FROM local_run_observations o WHERE o.run_id=j.run_id AND o.job_key=j.job_key))", run, key).Scan(&ok)
	return ok, err
}

// Link matching observations instead of retiming or duplicating their vectors.
func (s *Store) ReuseLocalJob(ctx context.Context, run, key, cache string) (bool, error) {
	s.write.Lock()
	defer s.write.Unlock()
	tx, err := s.writer.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	var from, job string
	err = tx.QueryRowContext(ctx, "SELECT j.run_id,j.job_key FROM local_run_jobs j WHERE cache_key=? AND status='completed' AND EXISTS(SELECT 1 FROM local_run_observations o WHERE o.run_id=j.run_id AND o.job_key=j.job_key) ORDER BY (SELECT created FROM local_runs WHERE id=j.run_id) DESC LIMIT 1", cache).Scan(&from, &job)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT OR REPLACE INTO local_run_jobs VALUES(?,?,?,'completed')", run, key, cache); err != nil {
		return false, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT OR IGNORE INTO local_run_observations SELECT ?,?,observation_id,platform_id FROM local_run_observations WHERE run_id=? AND job_key=?", run, key, from, job); err != nil {
		return false, err
	}
	return true, tx.Commit()
}
func (s *Store) PutLocalCapture(ctx context.Context, run, key, cache string, c benchdb.Capture) error {
	_, err := s.put(ctx, c, func(tx *sql.Tx, c benchdb.Capture, pid int64) error {
		if _, err := tx.ExecContext(ctx, "INSERT OR REPLACE INTO local_run_jobs VALUES(?,?,?,'completed')", run, key, cache); err != nil {
			return err
		}
		for _, row := range c.Results {
			result, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO local_run_observations(run_id,job_key,observation_id,platform_id) SELECT ?,?,o.id,? FROM observations o JOIN configurations cfg ON cfg.id=o.configuration_id JOIN engines e ON e.id=cfg.engine_id JOIN contracts ct ON ct.id=o.contract_id JOIN workloads w ON w.id=ct.workload_id WHERE o.captured_at=? AND e.name=? AND cfg.version=? AND cfg.backend=? AND w.name=? AND ct.artifact=? AND ct.digest=? AND o.phase=?`, run, key, pid, c.CapturedAt, row.Engine, row.Version, row.Backend, row.Workload, unhex(row.Artifact), unhex(row.Contract), phaseID(row.Phase))
			if err != nil {
				return err
			}
			n, err := result.RowsAffected()
			if err != nil {
				return err
			}
			if n != 1 {
				return fmt.Errorf("captured observation was not stored for %s/%s", row.Workload, row.Phase)
			}
		}
		return nil
	})
	return err
}
func unhex(text string) []byte { b, _ := hex.DecodeString(text); return b }

type LocalValue struct {
	Observation string   `json:"observation"`
	Platform    string   `json:"platform"`
	CapturedAt  string   `json:"capturedAt"`
	Engine      string   `json:"engine"`
	Version     string   `json:"version"`
	Workload    string   `json:"workload"`
	Artifact    string   `json:"artifact"`
	Contract    string   `json:"contract"`
	Phase       string   `json:"phase"`
	Status      string   `json:"status"`
	Latency     *float64 `json:"latencyNs"`
	RSS         *float64 `json:"rssBytes"`
	Code        *float64 `json:"codeBytes"`
}

func (s *Store) LocalValues(ctx context.Context, run string) ([]LocalValue, error) {
	rows, err := s.reader.QueryContext(ctx, `SELECT DISTINCT o.id,lower(hex(p.digest)),o.captured_at,e.name,cfg.version,w.name,lower(hex(ct.artifact)),lower(hex(ct.digest)),o.phase,o.latency_status,o.latency,o.peak_rss,o.code_bytes FROM local_run_observations l JOIN observations o ON o.id=l.observation_id JOIN platforms p ON p.id=l.platform_id JOIN configurations cfg ON cfg.id=o.configuration_id JOIN engines e ON e.id=cfg.engine_id JOIN contracts ct ON ct.id=o.contract_id JOIN workloads w ON w.id=ct.workload_id WHERE l.run_id=? ORDER BY e.name,w.name,o.phase`, run)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []LocalValue{}
	phases := []string{"compile", "instantiate", "first-call", "steady"}
	statuses := []string{"", "ok", "failed", "unsupported", "disabled", "not-measured", "unavailable"}
	for rows.Next() {
		var v LocalValue
		var phase, status int
		if err := rows.Scan(&v.Observation, &v.Platform, &v.CapturedAt, &v.Engine, &v.Version, &v.Workload, &v.Artifact, &v.Contract, &phase, &status, &v.Latency, &v.RSS, &v.Code); err != nil {
			return nil, err
		}
		v.Phase = phases[phase]
		v.Status = statuses[status]
		out = append(out, v)
	}
	return out, rows.Err()
}

// Finalize build fingerprints while a run is still unmeasured.
func (s *Store) FinalizeLocalPlan(ctx context.Context, id string, plan []byte) error {
	if !json.Valid(plan) || len(plan) > 8<<20 {
		return fmt.Errorf("invalid local run plan")
	}
	var packed bytes.Buffer
	z := gzip.NewWriter(&packed)
	if _, err := z.Write(plan); err != nil {
		return err
	}
	if err := z.Close(); err != nil {
		return err
	}
	result, err := s.writer.ExecContext(ctx, "UPDATE local_runs SET plan=?,updated=? WHERE id=? AND status IN('planned','paused','failed') AND NOT EXISTS(SELECT 1 FROM local_run_jobs WHERE run_id=?)", packed.Bytes(), time.Now().UTC().Format(time.RFC3339Nano), id, id)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n != 1 {
		return fmt.Errorf("a measured run plan is immutable")
	}
	return nil
}

// A feature performance prerequisite must have measurements and pass every row.
func (s *Store) LocalJobPassed(ctx context.Context, run, key string) (bool, error) {
	var passed bool
	err := s.reader.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM local_run_observations WHERE run_id=? AND job_key=?) AND NOT EXISTS(SELECT 1 FROM local_run_observations l JOIN observations o ON o.id=l.observation_id WHERE l.run_id=? AND l.job_key=? AND o.latency_status!=1)`, run, key, run, key).Scan(&passed)
	return passed, err
}
