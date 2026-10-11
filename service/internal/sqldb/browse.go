package sqldb

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/JairusSW/wasm.fyi/service/internal/benchdb"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"strings"
	"time"
)

// Cell contains scalar values and a stable detail key, never raw sample vectors.
type Cell struct {
	ObservationID int64        `json:"observationId"`
	SampleStats   *SampleStats `json:"sampleStats,omitempty"`
	benchdb.Result
}
type MatrixQuery struct {
	Platform, Phase, Workload, Engine, Corpus string
	Revision                                  string
	Offset                                    int
	Limit                                     int
}
type Matrix struct {
	Revision   string `json:"revision"`
	Platform   string `json:"platform"`
	Phase      string `json:"phase"`
	Items      []Cell `json:"items"`
	Total      int    `json:"total"`
	NextOffset *int   `json:"nextOffset"`
}

func (s *Store) Matrix(ctx context.Context, q MatrixQuery) (Matrix, error) {
	return s.browse(ctx, q, false, "", "")
}
func (s *Store) History(ctx context.Context, q MatrixQuery, from, to string) (Matrix, error) {
	return s.browse(ctx, q, true, from, to)
}
func (s *Store) browse(ctx context.Context, q MatrixQuery, history bool, from, to string) (Matrix, error) {
	if history {
		var err error
		from, err = historyDay(from)
		if err != nil {
			return Matrix{}, err
		}
		to, err = historyDay(to)
		if err != nil {
			return Matrix{}, err
		}
		if from != "" && to != "" && from > to {
			return Matrix{}, wire.Invalid("invalid history range")
		}
	}
	out := Matrix{Items: []Cell{}, Platform: q.Platform, Phase: q.Phase}
	if q.Phase == "" {
		q.Phase = "steady"
		out.Phase = q.Phase
	}
	if q.Corpus != "" && q.Corpus != "main" && q.Corpus != "features" {
		return out, wire.Invalid("corpus must be main or features")
	}
	if !benchdb.ValidPhase(q.Phase) || q.Limit < 1 || q.Limit > 4096 || q.Offset < 0 || q.Offset > 5000000 || q.Offset > 0 && q.Revision == "" {
		return out, wire.Invalid("valid phase/bounded limit required")
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
	scopeKey := "latest-revision/"
	if history {
		scopeKey = "history-revision/"
	}
	out.Revision, e = revision(ctx, tx, fmt.Sprint(scopeKey, pid))
	if e != nil {
		return out, e
	}
	scope := []any{out.Revision, q.Platform, q.Phase, q.Workload, q.Engine, q.Corpus, history, from, to}
	if history {
		scope = append(scope, "inclusive-utc-day-bounds-v2")
	}
	out.Revision = hash(scope)
	if q.Revision != "" && q.Revision != out.Revision {
		return out, benchdb.ErrChanged
	}
	table := "latest"
	where := "b.platform_id=? AND b.phase=?"
	args := []any{pid, phaseID(q.Phase)}
	if history {
		table = "history"
	}
	if q.Corpus == "main" {
		where += " AND substr(w.name,1,9)<>'features/'"
	}
	if q.Corpus == "features" {
		where += " AND substr(w.name,1,9)='features/'"
	}
	if q.Workload != "" {
		where += " AND w.name=?"
		args = append(args, q.Workload)
	}
	if q.Engine != "" {
		where += " AND e.name=?"
		args = append(args, q.Engine)
	}
	if history && from != "" {
		where += " AND snap.as_of_ns>=?"
		start, _ := time.Parse("2006-01-02", from)
		args = append(args, start.UnixNano())
	}
	if history && to != "" {
		where += " AND snap.as_of_ns<?"
		end, _ := time.Parse("2006-01-02", to)
		args = append(args, end.AddDate(0, 0, 1).UnixNano())
	}
	if e = tx.QueryRowContext(ctx, "SELECT count(*) FROM "+table+" b"+joins+"WHERE "+where, args...).Scan(&out.Total); e != nil {
		return out, e
	}
	args = append(args, q.Limit, q.Offset)
	order := "w.name,e.name"
	if history {
		order = "b.as_of DESC,w.name,e.name,cfg.id"
	}
	rows, e := tx.QueryContext(ctx, "SELECT "+projection+" FROM "+table+" b"+joins+"WHERE "+where+" ORDER BY "+order+" LIMIT ? OFFSET ?", args...)
	if e != nil {
		return out, e
	}
	defer rows.Close()
	for rows.Next() {
		id, r, e := scanResult(rows)
		if e != nil {
			return out, e
		}
		out.Items = append(out.Items, Cell{ObservationID: id, Result: r})
	}
	if e = rows.Err(); e != nil {
		return out, e
	}
	rows.Close()
	if e = loadCellStats(ctx, tx, out.Items); e != nil {
		return out, e
	}
	if q.Offset+len(out.Items) < out.Total {
		next := q.Offset + len(out.Items)
		out.NextOffset = &next
	}
	return out, rows.Err()
}

type EngineSummary struct {
	Engine         string   `json:"engine"`
	Phase          string   `json:"phase"`
	Total          int      `json:"total"`
	Passed         int      `json:"passed"`
	Failed         int      `json:"failed"`
	Unsupported    int      `json:"unsupported"`
	AverageLatency *float64 `json:"averageLatencyNs"`
	AverageRSS     *float64 `json:"averageRssBytes"`
	AverageCode    *float64 `json:"averageCodeBytes"`
}
type Overview struct {
	Revision string          `json:"revision"`
	Platform string          `json:"platform"`
	Items    []EngineSummary `json:"items"`
}

func (s *Store) Overview(ctx context.Context, platform string) (Overview, error) {
	out := Overview{Platform: platform, Items: []EngineSummary{}}
	tx, e := s.reader.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	pid, e := platformLookup(ctx, tx, platform)
	if e != nil {
		return out, e
	}
	out.Revision, e = revision(ctx, tx, fmt.Sprint("revision/", pid))
	if e != nil {
		return out, e
	}
	rows, e := tx.QueryContext(ctx, `SELECT e.name,b.phase,count(*),sum(o.latency_status=1),sum(o.latency_status=2),sum(o.latency_status=3),avg(CASE WHEN o.latency_status=1 THEN o.latency END),avg(CASE WHEN o.memory_status=1 THEN o.peak_rss END),avg(CASE WHEN o.code_status=1 THEN o.code_bytes END) FROM latest b JOIN engines e ON e.id=b.engine_id JOIN observations o ON o.id=b.observation_id WHERE b.platform_id=? GROUP BY b.engine_id,b.phase ORDER BY e.name,b.phase`, pid)
	if e != nil {
		return out, e
	}
	defer rows.Close()
	for rows.Next() {
		var v EngineSummary
		var phase int
		var latency, rss, code sql.NullFloat64
		if e = rows.Scan(&v.Engine, &phase, &v.Total, &v.Passed, &v.Failed, &v.Unsupported, &latency, &rss, &code); e != nil {
			return out, e
		}
		v.Phase = phases[phase]
		if latency.Valid {
			v.AverageLatency = &latency.Float64
		}
		if rss.Valid {
			v.AverageRSS = &rss.Float64
		}
		if code.Valid {
			v.AverageCode = &code.Float64
		}
		out.Items = append(out.Items, v)
	}
	return out, rows.Err()
}

func (s *Store) Summary(ctx context.Context) (benchdb.Summary, error) {
	out := benchdb.Summary{Platforms: []benchdb.PlatformSummary{}}
	tx, e := s.reader.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	out.Revision, e = revision(ctx, tx, "revision")
	if e != nil {
		return out, e
	}
	rows, e := tx.QueryContext(ctx, `SELECT hex(p.digest),p.os,p.arch,p.cpu,p.cores,p.kernel,p.memory_bytes,t.latest_rows,t.history_rows,t.captured_at,t.latest_samples,t.all_samples,rv.value,COALESCE(iv.value,lv.value),lr.value,hr.value FROM platforms p JOIN platform_totals t ON t.platform_id=p.id LEFT JOIN metadata rv ON rv.key='revision/'||p.id LEFT JOIN metadata iv ON iv.key='imported/'||lower(hex(p.digest)) LEFT JOIN metadata lv ON lv.key='legacy/prepared/imported/'||lower(hex(p.digest)) LEFT JOIN metadata lr ON lr.key='latest-revision/'||p.id LEFT JOIN metadata hr ON hr.key='history-revision/'||p.id ORDER BY p.cpu,p.arch,p.digest`)
	if e != nil {
		return out, e
	}
	defer rows.Close()
	for rows.Next() {
		var v benchdb.PlatformSummary
		var captured, scopedRevision, imported, latestRevision, historyRevision sql.NullString
		if e = rows.Scan(&v.ID, &v.OS, &v.Arch, &v.CPU, &v.Cores, &v.Kernel, &v.MemoryBytes, &v.LatestRows, &v.HistoryRows, &captured, &v.LatestTimingSamples, &v.AllTimingSamples, &scopedRevision, &imported, &latestRevision, &historyRevision); e != nil {
			return out, e
		}
		v.ID = strings.ToLower(v.ID)
		v.CapturedAt = captured.String
		v.Revision = scopedRevision.String
		v.ImportedAt = imported.String
		v.LatestRevision = latestRevision.String
		v.HistoryRevision = historyRevision.String
		out.Platforms = append(out.Platforms, v)
	}
	return out, rows.Err()
}
