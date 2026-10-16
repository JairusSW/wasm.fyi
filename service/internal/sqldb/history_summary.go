package sqldb

import (
	"context"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/benchdb"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

type HistoricalQuery struct {
	Platform, Metric, Baseline, Weighting, Cohort, Average, Workload, From, To string
	Engines                                                                    []string
	Platforms                                                                  []string
}
type HistoricalPair struct {
	FromDate  string   `json:"fromDate"`
	ToDate    string   `json:"toDate"`
	Before    *float64 `json:"before"`
	After     *float64 `json:"after"`
	Ratio     *float64 `json:"ratio"`
	Count     int      `json:"count"`
	Reference int      `json:"reference"`
	Reused    bool     `json:"reused"`
}
type HistoricalCalls struct {
	HostWasm     *float64 `json:"hostWasm"`
	WasmHostLoop *float64 `json:"wasmHostLoop"`
}
type HistoricalLane struct {
	Engine        string           `json:"engine"`
	Value         *float64         `json:"value"`
	Count         int              `json:"count"`
	Reference     int              `json:"reference"`
	Source        *benchdb.Source  `json:"source,omitempty"`
	Version       string           `json:"version"`
	Backend       string           `json:"backend"`
	LatestCreated string           `json:"latestCreated,omitempty"`
	Fingerprint   string           `json:"fingerprint,omitempty"`
	Previous      *HistoricalPair  `json:"previous,omitempty"`
	First         *HistoricalPair  `json:"first,omitempty"`
	Calls         *HistoricalCalls `json:"calls,omitempty"`
}
type HistoricalDate struct {
	Date  string           `json:"date"`
	Lanes []HistoricalLane `json:"lanes"`
}
type HistoricalSummaryResult struct {
	Revision  string           `json:"revision"`
	Platform  string           `json:"platform"`
	Metric    string           `json:"metric"`
	Workloads []string         `json:"workloads"`
	Items     []HistoricalDate `json:"items"`
}
type HistoricalChange struct {
	Engine string `json:"engine"`
	HistoricalPair
}
type HistoricalComparisonResult struct {
	Revision string             `json:"revision"`
	FromDate string             `json:"fromDate"`
	ToDate   string             `json:"toDate"`
	Items    []HistoricalChange `json:"items"`
}
type historyScalar struct {
	workload, contract, group, fingerprint, captured string
	value                                            float64
	ok                                               bool
	cfg                                              *aggregateConfiguration
}
type historyLane struct {
	cfg  *aggregateConfiguration
	rows map[string]historyScalar
}
type historicalDataset struct {
	dates      []string
	engines    []string
	workloads  []string
	lanes      map[string]map[string]*historyLane
	references map[string]map[string]bool
	bytes      int
}

const historyHostCall = "mechanisms/host-to-wasm-call"
const historyWasmCall = "mechanisms/wasm-host-wasm-loop"

func historyMetric(metric string) (string, string) {
	switch metric {
	case "exec":
		return "steady", "latency"
	case "compile":
		return "compile", "latency"
	case "inst":
		return "instantiate", "latency"
	case "mem":
		return "steady", "memory"
	case "code":
		return "compile", "code"
	case "cov":
		return "steady", "coverage"
	case "hostWasm", "wasmHostLoop", "callTotal":
		return "steady", "calls"
	}
	return "", ""
}
func historyCallIDs(q HistoricalQuery) []string {
	ids := []string{}
	switch q.Metric {
	case "hostWasm":
		ids = []string{historyHostCall}
	case "wasmHostLoop":
		ids = []string{historyWasmCall}
	case "callTotal":
		ids = []string{historyHostCall, historyWasmCall}
	}
	if q.Workload != "" {
		if contains(ids, q.Workload) {
			return []string{q.Workload}
		}
		return nil
	}
	return ids
}
func historyDay(s string) (string, error) {
	if s == "" {
		return "", nil
	}
	if t, e := time.Parse("2006-01-02", s); e == nil {
		return t.Format("2006-01-02"), nil
	}
	t, e := time.Parse(time.RFC3339Nano, s)
	if e != nil {
		return "", wire.Invalid("invalid history date")
	}
	return t.UTC().Format("2006-01-02"), nil
}
func normalizeHistory(q HistoricalQuery) (HistoricalQuery, error) {
	if len(q.Platforms) > 16 {
		return q, wire.Invalid("too many history environments")
	}
	if len(q.Platforms) > 0 {
		seen := map[string]bool{q.Platform: true}
		for _, platform := range q.Platforms {
			if len(platform) != 64 {
				return q, wire.Invalid("invalid history environment")
			}
			if _, err := hex.DecodeString(platform); err != nil {
				return q, wire.Invalid("invalid history environment")
			}
			seen[platform] = true
		}
		if len(seen) > 16 {
			return q, wire.Invalid("too many history environments")
		}
		q.Platforms = nil
		for platform := range seen {
			q.Platforms = append(q.Platforms, platform)
		}
		sort.Strings(q.Platforms)
	}
	if q.Metric == "" {
		q.Metric = "exec"
	}
	if _, kind := historyMetric(q.Metric); kind == "" {
		return q, wire.Invalid("invalid history metric")
	}
	a, e := normalizedAggregateQuery(AggregateQuery{Platform: q.Platform, Metric: "steady", Baseline: q.Baseline, Weighting: q.Weighting, Cohort: q.Cohort, Average: q.Average, Engines: q.Engines})
	if e != nil {
		return q, e
	}
	q.Baseline, q.Weighting, q.Cohort, q.Average, q.Engines = a.Baseline, a.Weighting, a.Cohort, a.Average, a.Engines
	q.From, e = historyDay(q.From)
	if e != nil {
		return q, e
	}
	q.To, e = historyDay(q.To)
	if e != nil {
		return q, e
	}
	if q.From != "" && q.To != "" && q.From > q.To {
		return q, wire.Invalid("invalid history range")
	}
	if q.Workload != "" && (len(q.Workload) > 512 || strings.HasPrefix(q.Workload, "features/")) {
		return q, wire.Invalid("invalid history workload")
	}
	_, kind := historyMetric(q.Metric)
	if kind == "calls" && q.Workload != "" && len(historyCallIDs(q)) == 0 {
		return q, wire.Invalid("invalid call workload")
	}
	return q, nil
}
func historyPositive(row aggregateScalar, kind string) (float64, bool) {
	switch kind {
	case "memory":
		return row.memory, row.memOK
	case "code":
		return row.code, row.codeOK
	default:
		return row.latency, row.latOK
	}
}
func historyReferences(latest *aggregateSnapshot, q HistoricalQuery, kind, phase string, engines []string) (map[string]map[string]bool, []string) {
	refs := map[string]map[string]bool{}
	cells := map[string]map[string]bool{}
	workloads := map[string]bool{}
	for _, r := range latest.rows {
		if r.phase != phase {
			continue
		}
		if q.Workload != "" && r.workload != q.Workload {
			continue
		}
		workloads[r.workload] = true
		key := r.workload + "|" + r.contract
		if cells[key] == nil {
			cells[key] = map[string]bool{}
		}
		_, ok := historyPositive(r, kind)
		if kind == "coverage" {
			ok = true
		}
		cells[key][r.cfg.engine] = ok
	}
	participants := []string{}
	for _, engine := range engines {
		for _, cell := range cells {
			if cell[engine] {
				participants = append(participants, engine)
				break
			}
		}
	}
	passing := map[string]map[string]bool{}
	for _, row := range latest.rows {
		if row.phase != "steady" {
			continue
		}
		key := row.workload + "|" + row.contract
		if passing[key] == nil {
			passing[key] = map[string]bool{}
		}
		passing[key][row.cfg.engine] = row.passed || row.latOK
	}
	anchor := leastCoveredEngine(participants, passing)
	if anchor == "" {
		passing = cells
		anchor = leastCoveredEngine(participants, cells)
	}
	for _, engine := range engines {
		refs[engine] = map[string]bool{}
		for key, cell := range cells {
			ok := cell[engine]
			if q.Cohort == "shared" && kind != "coverage" {
				ok = passing[key][anchor]
			}

			if ok {
				refs[engine][key] = true
			}
		}
	}
	ids := []string{}
	for w := range workloads {
		ids = append(ids, w)
	}
	sort.Strings(ids)
	return refs, ids
}
func loadHistoricalDataset(ctx context.Context, tx *sql.Tx, pids []int64, q HistoricalQuery, latest *aggregateSnapshot) (*historicalDataset, error) {
	phase, kind := historyMetric(q.Metric)
	d := &historicalDataset{lanes: map[string]map[string]*historyLane{}}
	marks := make([]string, len(pids))
	args := make([]any, 0, len(pids)+1)
	for i, pid := range pids {
		marks[i] = "?"
		args = append(args, pid)
	}
	where := "b.platform_id IN(" + strings.Join(marks, ",") + ") AND b.phase=? AND w.name NOT LIKE 'features/%'"
	args = append(args, phaseID(phase))
	if kind == "calls" {
		ids := historyCallIDs(q)
		marks := []string{}
		for _, id := range ids {
			marks = append(marks, "?")
			args = append(args, id)
		}
		where += " AND w.name IN(" + strings.Join(marks, ",") + ")"
	} else {
		where += " AND w.name NOT LIKE 'mechanisms/%'"
		if q.Workload != "" {
			where += " AND w.name=?"
			args = append(args, q.Workload)
		}
	}
	if q.From != "" {
		where += " AND snap.as_of_ns>=?"
		t, _ := time.Parse("2006-01-02", q.From)
		args = append(args, t.UnixNano())
	}
	if q.To != "" {
		t, _ := time.Parse("2006-01-02", q.To)
		where += " AND snap.as_of_ns<?"
		args = append(args, t.AddDate(0, 0, 1).UnixNano())
	}
	if len(q.Engines) > 0 {
		marks := []string{}
		for _, engine := range q.Engines {
			marks = append(marks, "?")
			args = append(args, engine)
		}
		where += " AND e.name IN(" + strings.Join(marks, ",") + ")"
	}
	rows, e := tx.QueryContext(ctx, `SELECT o.id,o.metric_bits,o.samples_id,o.timing_samples,o.display_id,o.sampling_id,o.code_kind,w.name,c.digest,d.data,e.name,cfg.version,cfg.backend,o.captured_at,o.latency,o.peak_rss,o.code_bytes,o.latency_status,o.memory_status,o.code_status,s.repository,s.revision,s.ref,s.kind,s.date_basis,snap.as_of FROM history b`+joins+"WHERE "+where+" ORDER BY b.as_of,o.captured_at,o.id", args...)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	configs := map[string]*aggregateConfiguration{}
	dates := map[string]bool{}
	engineSet := map[string]bool{}
	displayGroups := map[string]string{}
	for rows.Next() {
		var id int64
		var metricBits, contract, display []byte
		var sampleID, displayID, samplingID sql.NullInt64
		var acquisitionCount int
		var codeKind sql.NullString
		var r benchdb.Result
		var lat, mem, code sql.NullFloat64
		var ls, ms, cs int
		var repo, revision, ref, sourceKind, basis, asOf sql.NullString
		if e = rows.Scan(&id, &metricBits, &sampleID, &acquisitionCount, &displayID, &samplingID, &codeKind, &r.Workload, &contract, &display, &r.Engine, &r.Version, &r.Backend, &r.CapturedAt, &lat, &mem, &code, &ls, &ms, &cs, &repo, &revision, &ref, &sourceKind, &basis, &asOf); e != nil {
			return nil, e
		}
		r.Contract = hex.EncodeToString(contract)
		if repo.Valid {
			r.Source = &benchdb.Source{Repository: repo.String, Revision: revision.String, Ref: ref.String, Kind: sourceKind.String, DateBasis: basis.String, AsOf: asOf.String}
		}
		clock := asOf.String
		if clock == "" {
			clock = r.CapturedAt
		}
		day, e := historyDay(clock)
		if e != nil {
			return nil, e
		}
		if q.From != "" && day < q.From || q.To != "" && day > q.To {
			continue
		}
		dates[day] = true
		engineSet[r.Engine] = true
		key := configKey(r)
		cfg := configs[key]
		if cfg == nil {
			cfg = &aggregateConfiguration{key: key, engine: r.Engine, version: r.Version, backend: r.Backend, clock: clock, source: r.Source, qualified: qualified(r.Source), passed: ls == 1}
			configs[key] = cfg
			d.bytes += len(key) + 256
		} else if ls == 1 && !cfg.passed {
			cfg.version = r.Version
			cfg.backend = r.Backend
			cfg.passed = true
		}
		if d.lanes[day] == nil {
			d.lanes[day] = map[string]*historyLane{}
		}
		lane := d.lanes[day][r.Engine]
		if lane == nil || preferConfiguration(cfg, lane.cfg) {
			lane = &historyLane{cfg: cfg, rows: map[string]historyScalar{}}
			d.lanes[day][r.Engine] = lane
		}
		if lane.cfg != cfg {
			continue
		}
		value, ok := lat.Float64, lat.Valid && ls == 1 && lat.Float64 > 0
		if kind == "memory" {
			value, ok = mem.Float64, mem.Valid && ms == 1 && mem.Float64 > 0
		}
		if kind == "code" {
			value, ok = code.Float64, code.Valid && cs == 1 && code.Float64 > 0
		}
		if kind == "coverage" {
			value, ok = 1, ls == 1
		}
		if math.IsNaN(value) || math.IsInf(value, 0) {
			ok = false
		}
		group := displayGroups[string(display)]
		if len(display) > 0 && group == "" {
			var view benchdb.Display
			if e = json.Unmarshal(display, &view); e != nil {
				return nil, e
			}
			group = view.Group
			displayGroups[string(display)] = group
		}
		if group == "" {
			parts := strings.Split(r.Workload, "/")
			if len(parts) > 1 {
				group = parts[1]
			} else {
				group = "Other workloads"
			}
		}

		v := historyScalar{workload: r.Workload, contract: r.Contract, group: group, fingerprint: hash([]any{r.Source.Repository, r.Source.Revision, r.Engine, r.Version, r.Backend, r.Contract, r.CapturedAt, metricBits, sampleID, acquisitionCount, displayID, samplingID, codeKind, ls, ms, cs}), captured: r.CapturedAt, value: value, ok: ok, cfg: cfg}
		lane.rows[r.Workload+"|"+r.Contract] = v
		d.bytes += len(r.Workload) + len(r.Contract) + len(group) + len(v.fingerprint) + len(r.CapturedAt) + 128
	}
	if e = rows.Err(); e != nil {
		return nil, e
	}
	for date := range dates {
		d.dates = append(d.dates, date)
	}
	sort.Strings(d.dates)
	if len(q.Engines) > 0 {
		d.engines = append([]string(nil), q.Engines...)
	} else {
		for engine := range latest.engines {
			engineSet[engine] = true
		}
		for engine := range engineSet {
			d.engines = append(d.engines, engine)
		}
		sort.Strings(d.engines)
	}
	d.references, d.workloads = historyReferences(latest, q, kind, phase, d.engines)
	groups := map[string]string{}
	for _, row := range latest.rows {
		if row.phase == phase {
			groups[row.workload+"|"+row.contract] = row.group
		}
	}
	for _, engines := range d.lanes {
		for _, lane := range engines {
			for key, row := range lane.rows {
				if group := groups[key]; group != "" {
					row.group = group
					lane.rows[key] = row
				}
			}
		}
	}

	if kind == "calls" {
		d.workloads = historyCallIDs(q)
	}
	return d, nil
}
func historyRows(d *historicalDataset, q HistoricalQuery, date, engine string) map[string]historyScalar {
	out := map[string]historyScalar{}
	lane := d.lanes[date][engine]
	if lane == nil {
		return out
	}
	_, kind := historyMetric(q.Metric)
	ref := d.references[engine]
	for key, row := range lane.rows {
		if !row.ok {
			continue
		}
		if kind != "calls" && kind != "coverage" && q.Workload == "" && (q.Cohort == "shared" || kind != "coverage" && len(ref) > 0) && !ref[key] {
			continue
		}
		out[key] = row
	}
	return out
}
func historyValue(rows map[string]historyScalar, q HistoricalQuery) *float64 {
	_, kind := historyMetric(q.Metric)
	if len(rows) == 0 {
		return nil
	}
	if kind == "calls" {
		ids := historyCallIDs(q)
		sum := 0.0
		for _, id := range ids {
			found := false
			for _, r := range rows {
				if r.workload == id {
					sum += r.value
					found = true
					break
				}
			}
			if !found {
				return nil
			}
		}
		return &sum
	}
	if kind == "coverage" {
		v := float64(len(rows))
		return &v
	}
	keys := []string{}
	groups := map[string]int{}
	for key, r := range rows {
		keys = append(keys, key)
		groups[r.group]++
	}
	sort.Strings(keys)
	v := 0.0
	for _, key := range keys {
		r := rows[key]
		weight := 1 / float64(len(keys))
		if q.Weighting == "corpus" {
			weight = 1 / float64(len(groups)*groups[r.group])
		}
		if q.Average == "mean" {
			v += weight * r.value
		} else {
			v += weight * math.Log(r.value)
		}
	}
	if q.Average != "mean" {
		v = math.Exp(v)
	}
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return nil
	}
	return &v
}
func historyFingerprint(rows map[string]historyScalar) string {
	keys := []string{}
	for key := range rows {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := []string{}
	for _, key := range keys {
		parts = append(parts, key, rows[key].fingerprint)
	}
	if len(parts) == 0 {
		return ""
	}
	return hash(parts)
}
func historyReference(d *historicalDataset, q HistoricalQuery, engine string) int {
	_, kind := historyMetric(q.Metric)
	if kind == "calls" {
		return len(historyCallIDs(q))
	}
	if q.Workload != "" {
		return 1
	}
	return len(d.references[engine])
}
func historyPair(d *historicalDataset, q HistoricalQuery, engine, from, to string) *HistoricalPair {
	a, b := historyRows(d, q, from, engine), historyRows(d, q, to, engine)
	_, kind := historyMetric(q.Metric)
	if kind == "coverage" {
		av, bv := historyValue(a, q), historyValue(b, q)
		if av == nil || bv == nil {
			return nil
		}
		ratio := *bv / *av
		return &HistoricalPair{FromDate: from, ToDate: to, Before: av, After: bv, Ratio: &ratio, Reference: historyReference(d, q, engine), Reused: historyFingerprint(a) == historyFingerprint(b)}
	}
	left, right := map[string]historyScalar{}, map[string]historyScalar{}
	for key, row := range a {
		if other, ok := b[key]; ok {
			left[key] = row
			right[key] = other
		}
	}
	av, bv := historyValue(left, q), historyValue(right, q)
	if av == nil || bv == nil {
		return nil
	}
	ratio := *bv / *av
	if math.IsNaN(ratio) || math.IsInf(ratio, 0) {
		return nil
	}
	return &HistoricalPair{FromDate: from, ToDate: to, Before: av, After: bv, Ratio: &ratio, Count: len(left), Reference: historyReference(d, q, engine), Reused: historyFingerprint(left) == historyFingerprint(right)}
}
func computeHistoricalSummary(d *historicalDataset, q HistoricalQuery, rev string) HistoricalSummaryResult {
	out := HistoricalSummaryResult{Revision: rev, Platform: q.Platform, Metric: q.Metric, Workloads: append([]string(nil), d.workloads...), Items: []HistoricalDate{}}
	first, previous := map[string]string{}, map[string]string{}
	for _, date := range d.dates {
		point := HistoricalDate{Date: date, Lanes: []HistoricalLane{}}
		for _, engine := range d.engines {
			rows := historyRows(d, q, date, engine)
			v := historyValue(rows, q)
			lane := HistoricalLane{Engine: engine, Value: v, Count: len(rows), Reference: historyReference(d, q, engine), Fingerprint: historyFingerprint(rows)}
			if record := d.lanes[date][engine]; record != nil {
				lane.Version = record.cfg.version
				lane.Backend = record.cfg.backend
				lane.Source = record.cfg.source
			}
			for _, r := range rows {
				if lane.LatestCreated == "" || later(r.captured, lane.LatestCreated) {
					lane.LatestCreated = r.captured
				}
			}
			if q.Metric == "callTotal" {
				lane.Calls = &HistoricalCalls{}
				for _, r := range rows {
					vv := r.value
					if r.workload == historyHostCall {
						lane.Calls.HostWasm = &vv
					}
					if r.workload == historyWasmCall {
						lane.Calls.WasmHostLoop = &vv
					}
				}
			}
			if v != nil {
				if previous[engine] != "" {
					lane.Previous = historyPair(d, q, engine, previous[engine], date)
				}
				if first[engine] != "" {
					lane.First = historyPair(d, q, engine, first[engine], date)
				} else {
					first[engine] = date
				}
				previous[engine] = date
			}
			point.Lanes = append(point.Lanes, lane)
		}
		out.Items = append(out.Items, point)
	}
	return out
}
func (s *Store) historical(ctx context.Context, q HistoricalQuery) (HistoricalSummaryResult, *historicalDataset, error) {
	q, e := normalizeHistory(q)
	if e != nil {
		return HistoricalSummaryResult{}, nil, e
	}
	s.aggregateMu.Lock()
	defer s.aggregateMu.Unlock()
	tx, e := s.reader.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if e != nil {
		return HistoricalSummaryResult{}, nil, e
	}
	defer tx.Rollback()
	platforms := q.Platforms
	if len(platforms) == 0 {
		platforms = []string{q.Platform}
	}
	pids := make([]int64, 0, len(platforms))
	revisions := make([][]string, 0, len(platforms))
	snapshots := make([]*aggregateSnapshot, 0, len(platforms))
	type hostIdentity struct {
		OS, Arch, CPU string
		Cores         int
	}
	var host hostIdentity
	for i, platform := range platforms {
		pid, err := platformLookup(ctx, tx, platform)
		if err != nil {
			return HistoricalSummaryResult{}, nil, err
		}
		var current hostIdentity
		if err = tx.QueryRowContext(ctx, "SELECT os,arch,cpu,cores FROM platforms WHERE id=?", pid).Scan(&current.OS, &current.Arch, &current.CPU, &current.Cores); err != nil {
			return HistoricalSummaryResult{}, nil, err
		}
		if i == 0 {
			host = current
		} else if current != host {
			return HistoricalSummaryResult{}, nil, wire.Invalid("history environments must belong to the same host")
		}
		pids = append(pids, pid)
		hr, err := revision(ctx, tx, fmt.Sprint("history-revision/", pid))
		if err != nil {
			return HistoricalSummaryResult{}, nil, err
		}
		lr, err := revision(ctx, tx, fmt.Sprint("latest-revision/", pid))
		if err != nil {
			return HistoricalSummaryResult{}, nil, err
		}
		revisions = append(revisions, []string{platform, hr, lr})
		snapKey := "snapshot/" + platform + "/" + lr
		var snapshot *aggregateSnapshot
		if cached, ok := s.aggregateHit(snapKey); ok {
			snapshot = cached.snapshot
		} else {
			snapshot, err = loadAggregateSnapshot(ctx, tx, pid)
			if err != nil {
				return HistoricalSummaryResult{}, nil, err
			}
			s.aggregateRemember(snapKey, aggregateCacheEntry{snapshot: snapshot, bytes: snapshot.bytes})
		}
		snapshots = append(snapshots, snapshot)
	}
	rev := hash([]any{revisions, q})
	key := "history-summary/" + rev
	if cached, ok := s.aggregateHit(key); ok {
		return cloneHistory(*cached.historySummary), cached.historical, nil
	}
	latest := mergeHistorySnapshots(snapshots)
	d, e := loadHistoricalDataset(ctx, tx, pids, q, latest)
	if e != nil {
		return HistoricalSummaryResult{}, nil, e
	}
	out := computeHistoricalSummary(d, q, rev)
	s.aggregateRemember(key, aggregateCacheEntry{historical: d, historySummary: &out, bytes: d.bytes + len(encode(out))})
	return cloneHistory(out), d, nil
}
func cloneHistory(v HistoricalSummaryResult) HistoricalSummaryResult {
	var out HistoricalSummaryResult
	_ = json.Unmarshal(encode(v), &out)
	return out
}
func (s *Store) HistoricalSummary(ctx context.Context, q HistoricalQuery) (HistoricalSummaryResult, error) {
	out, _, e := s.historical(ctx, q)
	return out, e
}
func (s *Store) HistoricalComparison(ctx context.Context, q HistoricalQuery, fromDate, toDate string) (HistoricalComparisonResult, error) {
	q, e := normalizeHistory(q)
	if e != nil {
		return HistoricalComparisonResult{}, e
	}
	from, e := historyDay(fromDate)
	if e != nil {
		return HistoricalComparisonResult{}, e
	}
	to, e := historyDay(toDate)
	if e != nil {
		return HistoricalComparisonResult{}, e
	}
	if from == "" || to == "" || from > to {
		return HistoricalComparisonResult{}, wire.Invalid("invalid comparison date range")
	}
	summary, d, e := s.historical(ctx, q)
	if e != nil {
		return HistoricalComparisonResult{}, e
	}
	out := HistoricalComparisonResult{Revision: summary.Revision, FromDate: from, ToDate: to, Items: []HistoricalChange{}}
	for _, engine := range d.engines {
		a, b := historyEndpoints(d, q, engine, from, to)
		if a == "" || a == b {
			continue
		}
		if pair := historyPair(d, q, engine, a, b); pair != nil {
			out.Items = append(out.Items, HistoricalChange{Engine: engine, HistoricalPair: *pair})
		}
	}
	return out, nil
}

type HistoricalReportRow struct {
	Workload string  `json:"workload"`
	Group    string  `json:"group"`
	Before   float64 `json:"before"`
	After    float64 `json:"after"`
	Ratio    float64 `json:"ratio"`
	Reused   bool    `json:"reused"`
}
type HistoricalReportResult struct {
	Revision string                `json:"revision"`
	Engine   string                `json:"engine"`
	FromDate string                `json:"fromDate"`
	ToDate   string                `json:"toDate"`
	Items    []HistoricalReportRow `json:"items"`
}

func historyEndpoints(d *historicalDataset, q HistoricalQuery, engine, from, to string) (string, string) {
	a, b := "", ""
	for _, date := range d.dates {
		if date < from || date > to {
			continue
		}
		if historyValue(historyRows(d, q, date, engine), q) != nil {
			if a == "" {
				a = date
			}
			b = date
		}
	}
	return a, b
}

// HistoricalReport derives only matched scalar cells from the very same cached
// reference population used for comparisons. It never reads sample vectors.
func (s *Store) HistoricalReport(ctx context.Context, q HistoricalQuery, engine, fromDate, toDate string) (HistoricalReportResult, error) {
	q, e := normalizeHistory(q)
	if e != nil {
		return HistoricalReportResult{}, e
	}
	if !wire.IsIdentity(engine) {
		return HistoricalReportResult{}, wire.Invalid("invalid report engine")
	}
	from, e := historyDay(fromDate)
	if e != nil {
		return HistoricalReportResult{}, e
	}
	to, e := historyDay(toDate)
	if e != nil {
		return HistoricalReportResult{}, e
	}
	if from == "" || to == "" || from > to {
		return HistoricalReportResult{}, wire.Invalid("invalid report range")
	}
	summary, d, e := s.historical(ctx, q)
	if e != nil {
		return HistoricalReportResult{}, e
	}
	a, b := historyEndpoints(d, q, engine, from, to)
	out := HistoricalReportResult{Revision: summary.Revision, Engine: engine, FromDate: a, ToDate: b, Items: []HistoricalReportRow{}}
	if a == "" || a == b {
		return out, nil
	}
	before, after := historyRows(d, q, a, engine), historyRows(d, q, b, engine)
	keys := []string{}
	for key := range before {
		if _, ok := after[key]; ok {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	for _, key := range keys {
		x, y := before[key], after[key]
		ratio := y.value / x.value
		if math.IsNaN(ratio) || math.IsInf(ratio, 0) {
			continue
		}
		out.Items = append(out.Items, HistoricalReportRow{Workload: x.workload, Group: x.group, Before: x.value, After: y.value, Ratio: ratio, Reused: x.fingerprint == y.fingerprint})
	}
	return out, nil
}
