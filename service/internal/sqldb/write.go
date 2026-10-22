package sqldb

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"github.com/JairusSW/wasm.fyi/service/internal/benchdb"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"sort"
	"strings"
	"time"
)

func qualified(s *benchdb.Source) bool {
	if s == nil {
		return false
	}
	if s.Kind != "current" {
		return true
	}
	v := strings.SplitN(s.Revision, "/", 2)[0]
	_, e := hex.DecodeString(v)
	return len(v) == 40 && e == nil
}
func later(a, b string) bool {
	x, _ := time.Parse(time.RFC3339Nano, a)
	y, _ := time.Parse(time.RFC3339Nano, b)
	return x.After(y)
}
func enrichment(a, b benchdb.Result) bool {
	if a.Status != "ok" || a.CodeStatus == "ok" || b.CodeStatus != "ok" || b.CodeBytes == nil || *b.CodeBytes <= 0 || b.CodeKind == nil {
		return false
	}
	a.CodeBytes = nil
	b.CodeBytes = nil
	a.CodeKind = nil
	b.CodeKind = nil
	a.CodeStatus = ""
	b.CodeStatus = ""
	return bytes.Equal(encode(a), encode(b)) && bytes.Equal(vector(a.SamplesNs), vector(b.SamplesNs)) && bytes.Equal(metrics(a.Row), metrics(b.Row))
}
func id(ctx context.Context, tx *sql.Tx, insert, selectSQL string, args, keys []any) (int64, error) {
	if _, e := tx.ExecContext(ctx, insert, args...); e != nil {
		return 0, e
	}
	var n int64
	e := tx.QueryRowContext(ctx, selectSQL, keys...).Scan(&n)
	return n, e
}
func blobID(ctx context.Context, tx *sql.Tx, table string, data []byte) (int64, error) {
	return id(ctx, tx, "INSERT OR IGNORE INTO "+table+"(digest,data) VALUES(?,?)", "SELECT id FROM "+table+" WHERE digest=?", []any{digest(data), data}, []any{digest(data)})
}
func (s *Store) platformID(ctx context.Context, tx *sql.Tx, p benchdb.Platform) (int64, error) {
	d := digest(encode(p))
	var existing int64
	err := tx.QueryRowContext(ctx, "SELECT id FROM platforms WHERE digest=?", d).Scan(&existing)
	if err == nil {
		return existing, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return 0, err
	}
	var total int
	if err = tx.QueryRowContext(ctx, "SELECT count(*) FROM platforms").Scan(&total); err != nil {
		return 0, err
	}
	if total >= 128 {
		return 0, wire.Invalid("platform limit exceeded")
	}
	return id(ctx, tx, "INSERT OR IGNORE INTO platforms(digest,os,arch,cpu,cores,kernel,memory_bytes) VALUES(?,?,?,?,?,?,?)", "SELECT id FROM platforms WHERE digest=?", []any{d, p.OS, p.Arch, p.CPU, p.Cores, p.Kernel, p.MemoryBytes}, []any{d})
}

type binding struct{ platform, workload, engine, configuration, observation, snapshot int64 }

func (s *Store) observation(ctx context.Context, tx *sql.Tx, pid int64, r benchdb.Result) (binding, error) {
	b := binding{platform: pid}
	var e error
	b.engine, e = id(ctx, tx, "INSERT OR IGNORE INTO engines(name) VALUES(?)", "SELECT id FROM engines WHERE name=?", []any{r.Engine}, []any{r.Engine})
	if e != nil {
		return b, e
	}
	cfg := []any{r.Engine, r.Version, r.Backend}
	cd := digest(encode(cfg))
	b.configuration, e = id(ctx, tx, "INSERT OR IGNORE INTO configurations(digest,engine_id,version,backend) VALUES(?,?,?,?)", "SELECT id FROM configurations WHERE digest=?", []any{cd, b.engine, r.Version, r.Backend}, []any{cd})
	if e != nil {
		return b, e
	}
	b.workload, e = id(ctx, tx, "INSERT OR IGNORE INTO workloads(name) VALUES(?)", "SELECT id FROM workloads WHERE name=?", []any{r.Workload}, []any{r.Workload})
	if e != nil {
		return b, e
	}
	con, _ := hex.DecodeString(r.Contract)
	art, _ := hex.DecodeString(r.Artifact)
	var contractID int64
	var oldWork int64
	var oldWasm string
	var oldArt []byte
	e = tx.QueryRowContext(ctx, "SELECT id,workload_id,wasm,artifact FROM contracts WHERE digest=?", con).Scan(&contractID, &oldWork, &oldWasm, &oldArt)
	if e == nil && (oldWork != b.workload || oldWasm != r.Wasm || !bytes.Equal(oldArt, art)) {
		return b, wire.Invalid("contract identity has conflicting metadata")
	}
	if e != nil && !errors.Is(e, sql.ErrNoRows) {
		return b, e
	}
	if errors.Is(e, sql.ErrNoRows) {
		contractID, e = id(ctx, tx, "INSERT INTO contracts(digest,workload_id,wasm,artifact) VALUES(?,?,?,?)", "SELECT id FROM contracts WHERE digest=?", []any{con, b.workload, r.Wasm, art}, []any{con})
		if e != nil {
			return b, e
		}
	}
	var sourceID, displayID, samplingID, samplesID any
	normalized := r
	if r.Source != nil {
		base := *r.Source
		base.AsOf = ""
		sd := []any{base.Repository, base.Revision, base.Ref, base.Kind, base.DateBasis}
		sid, e := id(ctx, tx, "INSERT OR IGNORE INTO sources(repository,revision,ref,kind,date_basis) VALUES(?,?,?,?,?)", "SELECT id FROM sources WHERE repository=? AND revision=? AND ref=? AND kind=? AND date_basis=?", sd, sd)
		if e != nil {
			return b, e
		}
		sourceID = sid
		t, _ := time.Parse(time.RFC3339Nano, r.Source.AsOf)
		b.snapshot, e = id(ctx, tx, "INSERT OR IGNORE INTO snapshots(source_id,as_of,as_of_ns,qualified) VALUES(?,?,?,?)", "SELECT id FROM snapshots WHERE source_id=? AND as_of=?", []any{sid, r.Source.AsOf, t.UnixNano(), qualified(r.Source)}, []any{sid, r.Source.AsOf})
		if e != nil {
			return b, e
		}
		normalized.Source = &base
	}
	if r.Display != nil {
		displayID, e = blobID(ctx, tx, "displays", encode(r.Display))
		if e != nil {
			return b, e
		}
	}
	if r.Sampling != nil {
		samplingID, e = blobID(ctx, tx, "sampling_policies", encode(r.Sampling))
		if e != nil {
			return b, e
		}
	}
	if r.SamplesNs != nil {
		raw := vector(r.SamplesNs)
		samplesID, e = id(ctx, tx, "INSERT OR IGNORE INTO sample_vectors(digest,count,data) VALUES(?,?,?)", "SELECT id FROM sample_vectors WHERE digest=?", []any{digest(raw), len(r.SamplesNs), raw}, []any{digest(raw)})
		if e != nil {
			return b, e
		}
	}
	raw := append(encode(normalized), metrics(r.Row)...)
	raw = append(raw, vector(r.SamplesNs)...)
	d := digest(raw)
	t, _ := time.Parse(time.RFC3339Nano, r.CapturedAt)
	b.observation, e = id(ctx, tx, "INSERT OR IGNORE INTO observations(digest,contract_id,configuration_id,source_id,display_id,sampling_id,samples_id,captured_at,captured_ns,phase,latency,peak_rss,code_bytes,metric_bits,latency_status,memory_status,code_status,code_kind,timing_samples) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", "SELECT id FROM observations WHERE digest=?", []any{d, contractID, b.configuration, sourceID, displayID, samplingID, samplesID, r.CapturedAt, t.UnixNano(), phaseID(r.Phase), r.Value, r.PeakRSS, r.CodeBytes, metrics(r.Row), statusID(r.Status), statusID(r.MemoryStatus), statusID(r.CodeStatus), r.CodeKind, r.TimingSamples}, []any{d})
	if e == nil {
		e = putSampleStats(ctx, tx, b.observation, r.SamplesNs, r.Sampling)
	}
	if e == nil {
		e = putFeatureProfile(ctx, tx, b.observation, r.FeatureProfile)
	}
	return b, e
}
func (s *Store) Put(ctx context.Context, c benchdb.Capture) (string, error) {
	if e := benchdb.Validate(c); e != nil {
		return "", e
	}
	keys := []string{}
	for _, r := range c.Results {
		keys = append(keys, r.Workload+"|"+r.Engine+"|"+r.Phase)
	}
	sort.Strings(keys)
	p := c.Platform
	scope := []any{p.OS, p.Arch, p.CPU, p.Cores, p.Kernel, p.MemoryBytes}
	for _, k := range keys {
		scope = append(scope, k)
	}
	captureID := hash(scope)
	s.write.Lock()
	defer s.write.Unlock()
	tx, e := s.writer.BeginTx(ctx, nil)
	if e != nil {
		return "", e
	}
	defer tx.Rollback()
	p, e = canonicalMemoryPlatform(ctx, tx, p)
	if e != nil {
		return "", e
	}
	c.Platform = p
	scope[5] = p.MemoryBytes
	captureID = hash(scope)
	pid, e := s.platformID(ctx, tx, p)
	if e != nil {
		return "", e
	}
	changed := false
	newBindings := 0
	for _, row := range c.Results {
		if row.Source == nil {
			row.Source = c.Source
		}
		if row.FeatureProfile == "" {
			row.FeatureProfile = c.FeatureProfile
		}
		blocked, err := revisionBlocked(ctx, tx, row.Engine, row.Source)
		if err != nil {
			return "", err
		}
		if blocked {
			continue
		}
		next := benchdb.Result{Row: row, CapturedAt: c.CapturedAt}
		b, e := s.observation(ctx, tx, pid, next)
		if e != nil {
			return "", e
		}
		if row.Source != nil {
			old, e := loadBinding(ctx, tx, true, pid, row.Workload, row.Engine, row.Phase, row.Source.AsOf, b.configuration, true)
			if e != nil && !errors.Is(e, sql.ErrNoRows) {
				return "", e
			}
			if errors.Is(e, sql.ErrNoRows) || later(next.CapturedAt, old.CapturedAt) || enrichment(old, next) {
				if errors.Is(e, sql.ErrNoRows) {
					newBindings++
				}
				_, e = tx.ExecContext(ctx, "INSERT INTO history(platform_id,workload_id,configuration_id,phase,as_of,observation_id,snapshot_id) VALUES(?,?,?,?,?,?,?) ON CONFLICT(platform_id,as_of,workload_id,configuration_id,phase) DO UPDATE SET observation_id=excluded.observation_id,snapshot_id=excluded.snapshot_id", pid, b.workload, b.configuration, phaseID(row.Phase), row.Source.AsOf, b.observation, b.snapshot)
				if e != nil {
					return "", e
				}
				changed = true
			}
		}
		old, e := loadBinding(ctx, tx, false, pid, row.Workload, row.Engine, row.Phase, "", 0, true)
		if e != nil && !errors.Is(e, sql.ErrNoRows) {
			return "", e
		}
		replace := errors.Is(e, sql.ErrNoRows)
		if replace {
			newBindings++
		}
		if !replace {
			ahead := false
			if row.Source != nil && old.Source != nil {
				if qualified(row.Source) != qualified(old.Source) {
					if !qualified(row.Source) {
						continue
					}
					ahead = true
				} else if row.Source.AsOf != old.Source.AsOf {
					if !later(row.Source.AsOf, old.Source.AsOf) {
						continue
					}
					ahead = true
				}
			}
			replace = ahead || later(next.CapturedAt, old.CapturedAt) || enrichment(old, next)
			if !replace && next.CapturedAt == old.CapturedAt && ((old.Source == nil && row.Source != nil) || (old.Display == nil && row.Display != nil)) {
				next.Status = old.Status
				next.Value = old.Value
				next.PeakRSS = old.PeakRSS
				next.CodeBytes = old.CodeBytes
				next.CodeKind = old.CodeKind
				next.MemoryStatus = old.MemoryStatus
				next.CodeStatus = old.CodeStatus
				b, e = s.observation(ctx, tx, pid, next)
				if e != nil {
					return "", e
				}
				replace = true
			}
		}
		if replace {
			_, e = tx.ExecContext(ctx, "INSERT INTO latest(platform_id,workload_id,engine_id,phase,observation_id,snapshot_id) VALUES(?,?,?,?,?,?) ON CONFLICT(platform_id,workload_id,engine_id,phase) DO UPDATE SET observation_id=excluded.observation_id,snapshot_id=excluded.snapshot_id", pid, b.workload, b.engine, phaseID(row.Phase), b.observation, nullID(b.snapshot))
			if e != nil {
				return "", e
			}
			changed = true
		}
	}
	if changed {
		_, e = tx.ExecContext(ctx, "INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", "imported/"+hash(c.Platform), time.Now().UTC().Format(time.RFC3339Nano))
		if e != nil {
			return "", e
		}
		if e = addBindings(ctx, tx, newBindings); e != nil {
			return "", e
		}
		if e = bump(ctx, tx, pid, encode(c)); e != nil {
			return "", e
		}
	}
	if e = tx.Commit(); e != nil {
		return "", e
	}
	return captureID, nil
}
func nullID(n int64) any {
	if n == 0 {
		return nil
	}
	return n
}
func bump(ctx context.Context, tx *sql.Tx, pid int64, data []byte) error {
	for _, key := range []string{"revision", fmt.Sprint("revision/", pid)} {
		var old []byte
		e := tx.QueryRowContext(ctx, "SELECT value FROM metadata WHERE key=?", key).Scan(&old)
		if e != nil && !errors.Is(e, sql.ErrNoRows) {
			return e
		}
		next := hex.EncodeToString(digest(append(old, data...)))
		if _, e = tx.ExecContext(ctx, "INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", key, next); e != nil {
			return e
		}
	}
	_, e := tx.ExecContext(ctx, "DELETE FROM prepared WHERE platform_id=?", pid)
	return e
}

// Binding is a lossless latest/history reference used by copy migration.
type Binding struct {
	Scope    string
	Platform benchdb.Platform
	Result   benchdb.Result
}

func (s *Store) ImportBinding(ctx context.Context, scope string, p benchdb.Platform, r benchdb.Result) error {
	return s.ImportBatch(ctx, []Binding{{scope, p, r}})
}

// ImportBatch commits at most 4096 source bindings atomically, amortizing FULL sync.
func (s *Store) ImportBatch(ctx context.Context, bindings []Binding) error {
	if len(bindings) == 0 || len(bindings) > 4096 {
		return fmt.Errorf("invalid migration batch size")
	}
	s.write.Lock()
	defer s.write.Unlock()
	tx, e := s.writer.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	platforms := map[int64]bool{}
	imported := 0
	for _, item := range bindings {
		scope, p, r := item.Scope, item.Platform, item.Result
		if scope != "latest" && scope != "history" {
			return fmt.Errorf("invalid binding scope")
		}
		if e = benchdb.Validate(benchdb.Capture{Platform: p, CapturedAt: r.CapturedAt, Results: []benchdb.Row{r.Row}}); e != nil {
			return e
		}
		if scope == "history" && r.Source == nil {
			return fmt.Errorf("history source required")
		}
		blocked, err := revisionBlocked(ctx, tx, r.Engine, r.Source)
		if err != nil {
			return err
		}
		if blocked {
			continue
		}
		pid, e := s.platformID(ctx, tx, p)
		if e != nil {
			return e
		}
		b, e := s.observation(ctx, tx, pid, r)
		if e != nil {
			return e
		}
		if scope == "latest" {
			_, e = tx.ExecContext(ctx, "INSERT INTO latest(platform_id,workload_id,engine_id,phase,observation_id,snapshot_id) VALUES(?,?,?,?,?,?)", pid, b.workload, b.engine, phaseID(r.Phase), b.observation, nullID(b.snapshot))
		} else {
			_, e = tx.ExecContext(ctx, "INSERT INTO history(platform_id,workload_id,configuration_id,phase,as_of,observation_id,snapshot_id) VALUES(?,?,?,?,?,?,?)", pid, b.workload, b.configuration, phaseID(r.Phase), r.Source.AsOf, b.observation, b.snapshot)
		}
		if e != nil {
			return e
		}
		platforms[pid] = true
		imported++
	}
	if e = addBindings(ctx, tx, imported); e != nil {
		return e
	}
	for pid := range platforms {
		if e = bump(ctx, tx, pid, encode(bindings)); e != nil {
			return e
		}
	}
	if e = tx.Commit(); e != nil {
		return e
	}
	return nil
}

func addBindings(ctx context.Context, tx *sql.Tx, n int) error {
	if n == 0 {
		return nil
	}
	var count int64
	e := tx.QueryRowContext(ctx, "SELECT value FROM metadata WHERE key='binding-count'").Scan(&count)
	if e != nil && !errors.Is(e, sql.ErrNoRows) {
		return e
	}
	count += int64(n)
	if count > 5000000 {
		return wire.Invalid("benchmark row limit exceeded")
	}
	_, e = tx.ExecContext(ctx, "INSERT INTO metadata(key,value) VALUES('binding-count',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", count)
	return e
}
