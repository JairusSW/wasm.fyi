package sqldb

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/JairusSW/wasm.fyi/service/internal/benchdb"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"strconv"
	"strings"
)

type queryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

const projection = `o.id,w.name,c.wasm,c.artifact,c.digest,e.name,cfg.version,cfg.backend,o.phase,o.captured_at,o.metric_bits,o.latency_status,o.memory_status,o.code_status,o.code_kind,o.timing_samples,d.data,sp.data,s.repository,s.revision,s.ref,s.kind,s.date_basis,snap.as_of`
const joins = ` JOIN observations o ON o.id=b.observation_id JOIN contracts c ON c.id=o.contract_id JOIN workloads w ON w.id=c.workload_id JOIN configurations cfg ON cfg.id=o.configuration_id JOIN engines e ON e.id=cfg.engine_id LEFT JOIN displays d ON d.id=o.display_id LEFT JOIN sampling_policies sp ON sp.id=o.sampling_id LEFT JOIN sources s ON s.id=o.source_id LEFT JOIN snapshots snap ON snap.id=b.snapshot_id `

type scanner interface{ Scan(...any) error }

func scanResult(v scanner) (int64, benchdb.Result, error) {
	var r benchdb.Result
	var id int64
	var phase, ls, ms, cs int
	var artifact, contract, mb, display, sampling []byte
	var kind, repo, rev, ref, sourceKind, basis, asOf sql.NullString
	e := v.Scan(&id, &r.Workload, &r.Wasm, &artifact, &contract, &r.Engine, &r.Version, &r.Backend, &phase, &r.CapturedAt, &mb, &ls, &ms, &cs, &kind, &r.TimingSamples, &display, &sampling, &repo, &rev, &ref, &sourceKind, &basis, &asOf)
	if e != nil {
		return id, r, e
	}
	if phase < 0 || phase >= len(phases) || len(mb) != 25 {
		return id, r, fmt.Errorf("corrupt observation encoding")
	}
	r.Phase = phases[phase]
	r.Artifact = hex.EncodeToString(artifact)
	r.Contract = hex.EncodeToString(contract)
	r.Status = statusName(ls)
	r.MemoryStatus = statusName(ms)
	r.CodeStatus = statusName(cs)
	unmetrics(mb, &r.Row)
	if kind.Valid {
		r.CodeKind = &kind.String
	}
	if display != nil {
		if e = json.Unmarshal(display, &r.Display); e != nil {
			return id, r, e
		}
	}
	if sampling != nil {
		if e = json.Unmarshal(sampling, &r.Sampling); e != nil {
			return id, r, e
		}
	}
	if repo.Valid {
		r.Source = &benchdb.Source{Repository: repo.String, Revision: rev.String, Ref: ref.String, Kind: sourceKind.String, DateBasis: basis.String, AsOf: asOf.String}
	}
	return id, r, nil
}
func loadBinding(ctx context.Context, q queryer, history bool, pid int64, workload, engine, phase, asOf string, cfg int64, samples bool) (benchdb.Result, error) {
	table := "latest"
	where := "b.platform_id=? AND w.name=? AND e.name=? AND b.phase=?"
	args := []any{pid, workload, engine, phaseID(phase)}
	if history {
		table = "history"
		where += " AND b.as_of=? AND b.configuration_id=?"
		args = append(args, asOf, cfg)
	}
	id, r, e := scanResult(q.QueryRowContext(ctx, "SELECT "+projection+" FROM "+table+" b"+joins+"WHERE "+where, args...))
	if e == nil && samples {
		r.SamplesNs, e = loadSamples(ctx, q, id)
	}
	return r, e
}
func loadSamples(ctx context.Context, q queryer, id int64) ([]float64, error) {
	var data []byte
	var sampleID sql.NullInt64
	e := q.QueryRowContext(ctx, "SELECT v.data,v.id FROM observations o LEFT JOIN sample_vectors v ON v.id=o.samples_id WHERE o.id=?", id).Scan(&data, &sampleID)
	if e != nil {
		return nil, e
	}
	if len(data)%8 != 0 {
		return nil, fmt.Errorf("corrupt sample vector")
	}
	if sampleID.Valid && data == nil {
		return []float64{}, nil
	}
	return unvector(data), nil
}
func revision(ctx context.Context, q queryer, key string) (string, error) {
	var r string
	e := q.QueryRowContext(ctx, "SELECT value FROM metadata WHERE key=?", key).Scan(&r)
	if errors.Is(e, sql.ErrNoRows) {
		return hash(key), nil
	}
	return r, e
}
func platformLookup(ctx context.Context, q queryer, d string) (int64, error) {
	if !wire.IsHash(d) {
		return 0, wire.Invalid("invalid platform")
	}
	b, _ := hex.DecodeString(d)
	var id int64
	e := q.QueryRowContext(ctx, "SELECT id FROM platforms WHERE digest=?", b).Scan(&id)
	if errors.Is(e, sql.ErrNoRows) {
		return 0, benchdb.ErrNotFound
	}
	return id, e
}
func (s *Store) Platforms(ctx context.Context) (benchdb.Catalog, error) {
	out := benchdb.Catalog{Items: []benchdb.PlatformChoice{}}
	tx, e := s.reader.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	out.Revision, e = revision(ctx, tx, "revision")
	if e != nil {
		return out, e
	}
	rows, e := tx.QueryContext(ctx, "SELECT hex(digest),os,arch,cpu,cores,kernel,memory_bytes FROM platforms ORDER BY cpu,arch,os,digest")
	if e != nil {
		return out, e
	}
	defer rows.Close()
	for rows.Next() {
		var p benchdb.PlatformChoice
		if e = rows.Scan(&p.ID, &p.OS, &p.Arch, &p.CPU, &p.Cores, &p.Kernel, &p.MemoryBytes); e != nil {
			return out, e
		}
		p.ID = strings.ToLower(p.ID)
		out.Items = append(out.Items, p)
	}
	return out, rows.Err()
}

type cursor struct {
	Revision, Platform, Phase string
	History                   bool
	After                     string
}

func (s *Store) token(c cursor) string {
	raw := encode(c)
	mac := hmac.New(sha256.New, s.cursorKey)
	mac.Write(raw)
	return base64.RawURLEncoding.EncodeToString(raw) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
func (s *Store) parse(token string) (cursor, error) {
	var c cursor
	p := strings.Split(token, ".")
	if len(p) != 2 {
		return c, wire.Invalid("invalid cursor")
	}
	raw, e := base64.RawURLEncoding.DecodeString(p[0])
	if e != nil || len(raw) > 2048 {
		return c, wire.Invalid("invalid cursor")
	}
	sig, e := base64.RawURLEncoding.DecodeString(p[1])
	if e != nil {
		return c, wire.Invalid("invalid cursor")
	}
	mac := hmac.New(sha256.New, s.cursorKey)
	mac.Write(raw)
	if !hmac.Equal(sig, mac.Sum(nil)) || json.Unmarshal(raw, &c) != nil {
		return c, wire.Invalid("invalid cursor")
	}
	return c, nil
}
func (s *Store) Page(ctx context.Context, q benchdb.Query) (benchdb.Page, error) {
	out := benchdb.Page{Items: []benchdb.Result{}}
	var c cursor
	var e error
	if q.Cursor != "" {
		c, e = s.parse(q.Cursor)
		if e != nil {
			return out, e
		}
		if q.Platform != "" && q.Platform != c.Platform || q.Phase != "" && q.Phase != c.Phase || q.History != c.History {
			return out, wire.Invalid("cursor scope differs from query")
		}
		q.Platform = c.Platform
		q.Phase = c.Phase
	}
	if q.Phase == "" {
		q.Phase = "steady"
	}
	if !benchdb.ValidPhase(q.Phase) || q.Limit < 1 || q.Limit > 1000 {
		return out, wire.Invalid("valid phase/page size required")
	}
	tx, e := s.reader.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	pid, e := platformLookup(ctx, tx, q.Platform)
	if e != nil {
		return out, e
	}
	out.Platform = q.Platform
	out.Phase = q.Phase
	out.Revision, e = revision(ctx, tx, fmt.Sprint("revision/", pid))
	if e != nil {
		return out, e
	}
	if q.Cursor != "" && c.Revision != out.Revision {
		return out, benchdb.ErrChanged
	}
	table := "latest"
	order := `w.name||char(0)||e.name`
	if q.History {
		table = "history"
		order = `b.as_of||char(0)||w.name||char(0)||printf('%020d',b.configuration_id)`
	}
	where := "b.platform_id=? AND b.phase=?"
	args := []any{pid, phaseID(q.Phase)}
	if e = tx.QueryRowContext(ctx, "SELECT count(*) FROM "+table+" b WHERE "+where, args...).Scan(&out.Total); e != nil {
		return out, e
	}
	if c.After != "" {
		where += " AND (" + order + ")>?"
		args = append(args, c.After)
	}
	args = append(args, q.Limit+1)
	rows, e := tx.QueryContext(ctx, "SELECT "+projection+",("+order+") FROM "+table+" b"+joins+"WHERE "+where+" ORDER BY "+order+" LIMIT ?", args...)
	if e != nil {
		return out, e
	}
	defer rows.Close()
	var after string
	for rows.Next() {
		var holder rowWithKey
		id, r, e := scanResult(&holderScanner{rows: rows, key: &holder.key})
		_ = id
		if e != nil {
			return out, e
		}
		if len(out.Items) == q.Limit {
			token := s.token(cursor{Revision: out.Revision, Platform: q.Platform, Phase: q.Phase, History: q.History, After: after})
			out.NextCursor = &token
			break
		}
		out.Items = append(out.Items, r)
		after = holder.key
	}
	return out, rows.Err()
}

type rowWithKey struct{ key string }
type holderScanner struct {
	rows *sql.Rows
	key  *string
}

func (h *holderScanner) Scan(args ...any) error { return h.rows.Scan(append(args, h.key)...) }

// Detail reads ordered samples only when a cell is selected. Optional asOf selects an alias explicitly.
func (s *Store) Detail(ctx context.Context, platform string, observationID int64, asOf ...string) (benchdb.Result, error) {
	tx, e := s.reader.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if e != nil {
		return benchdb.Result{}, e
	}
	defer tx.Rollback()
	pid, e := platformLookup(ctx, tx, platform)
	if e != nil {
		return benchdb.Result{}, e
	}
	query := "SELECT " + projection + " FROM latest b" + joins + "WHERE b.platform_id=? AND o.id=?"
	args := []any{pid, observationID}
	if len(asOf) > 0 {
		query = "SELECT " + projection + " FROM history b" + joins + "WHERE b.platform_id=? AND o.id=? AND b.as_of=?"
		args = append(args, asOf[0])
	}
	id, r, e := scanResult(tx.QueryRowContext(ctx, query, args...))
	if errors.Is(e, sql.ErrNoRows) && len(asOf) == 0 {
		id, r, e = scanResult(tx.QueryRowContext(ctx, "SELECT "+projection+" FROM history b"+joins+"WHERE b.platform_id=? AND o.id=? ORDER BY b.as_of DESC LIMIT 1", pid, observationID))
	}
	if errors.Is(e, sql.ErrNoRows) {
		return r, benchdb.ErrNotFound
	}
	if e != nil {
		return r, e
	}
	r.SamplesNs, e = loadSamples(ctx, tx, id)
	return r, e
}
func (s *Store) initialize(ctx context.Context) error {
	key := make([]byte, 32)
	if _, e := rand.Read(key); e != nil {
		return e
	}
	if _, e := s.writer.ExecContext(ctx, "INSERT OR IGNORE INTO metadata(key,value) VALUES('cursor-key',?)", key); e != nil {
		return e
	}
	return s.writer.QueryRowContext(ctx, "SELECT value FROM metadata WHERE key='cursor-key'").Scan(&s.cursorKey)
}

// Export visits each binding with full lossless sample vectors; callback must not write to this Store.
func (s *Store) Export(ctx context.Context, visit func(string, benchdb.Platform, benchdb.Result) error) error {
	for _, scope := range []string{"latest", "history"} {
		rows, e := s.reader.QueryContext(ctx, "SELECT "+projection+",p.os,p.arch,p.cpu,p.cores,p.kernel,p.memory_bytes FROM "+scope+" b"+joins+"JOIN platforms p ON p.id=b.platform_id ORDER BY b.platform_id,o.id")
		if e != nil {
			return e
		}
		for rows.Next() {
			var p benchdb.Platform
			h := &extraScanner{rows: rows, extra: []any{&p.OS, &p.Arch, &p.CPU, &p.Cores, &p.Kernel, &p.MemoryBytes}}
			id, r, e := scanResult(h)
			if e == nil {
				r.SamplesNs, e = loadSamples(ctx, s.reader, id)
			}
			if e == nil {
				e = visit(scope, p, r)
			}
			if e != nil {
				rows.Close()
				return e
			}
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return e
		}
	}
	return nil
}

type extraScanner struct {
	rows  *sql.Rows
	extra []any
}

func (h *extraScanner) Scan(a ...any) error { return h.rows.Scan(append(a, h.extra...)...) }

var _ = strconv.Itoa
