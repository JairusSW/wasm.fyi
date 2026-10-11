package sqldb

import (
	"context"
	"database/sql"
	"encoding/hex"
	"fmt"
	"github.com/JairusSW/wasm.fyi/service/internal/benchdb"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"math"
	"sort"
	"strings"
)

type AggregateQuery struct {
	Platform, Metric, Baseline, Weighting, Cohort, Average string
	Engines                                                []string
}
type AggregateCard struct {
	Engine        string          `json:"engine"`
	Version       string          `json:"version"`
	Backend       string          `json:"backend"`
	Source        *benchdb.Source `json:"source,omitempty"`
	Value         *float64        `json:"value"`
	Ratio         *float64        `json:"ratio"`
	Count         int             `json:"count"`
	LatestCreated string          `json:"latestCreated,omitempty"`
}
type AggregateResult struct {
	Revision     string          `json:"revision"`
	Platform     string          `json:"platform"`
	Metric       string          `json:"metric"`
	Participants []string        `json:"participants"`
	Workloads    []string        `json:"workloads"`
	Cards        []AggregateCard `json:"cards"`
}
type aggregateConfiguration struct {
	key, engine, version, backend, clock string
	source                               *benchdb.Source
	qualified, passed                    bool
}
type aggregateScalar struct {
	cfg                                          *aggregateConfiguration
	workload, contract, group, phase, capturedAt string
	latency, memory, code                        float64
	latOK, memOK, codeOK, passed                 bool
}
type aggregateSnapshot struct {
	rows    []aggregateScalar
	engines map[string]*aggregateConfiguration
	bytes   int
}
type aggregateCacheEntry struct {
	historical     *historicalDataset
	historySummary *HistoricalSummaryResult
	snapshot       *aggregateSnapshot
	result         *AggregateResult
	bytes          int
	use            uint64
}

const aggregateCacheBudget = 32 << 20

func (s *Store) invalidateAggregates() {
	s.aggregateMu.Lock()
	s.aggregateCache = nil
	s.aggregateBytes = 0
	s.aggregateMu.Unlock()
}
func (s *Store) aggregateRemember(key string, e aggregateCacheEntry) {
	if s.aggregateCache == nil {
		s.aggregateCache = map[string]aggregateCacheEntry{}
	}
	s.aggregateSequence++
	e.use = s.aggregateSequence
	s.aggregateCache[key] = e
	s.aggregateBytes += e.bytes
	for len(s.aggregateCache) > 128 || s.aggregateBytes > aggregateCacheBudget {
		oldKey := ""
		var oldest uint64 = ^uint64(0)
		for k, v := range s.aggregateCache {
			if v.use < oldest {
				oldest = v.use
				oldKey = k
			}
		}
		if oldKey == "" {
			break
		}
		s.aggregateBytes -= s.aggregateCache[oldKey].bytes
		delete(s.aggregateCache, oldKey)
	}
}
func (s *Store) aggregateHit(key string) (aggregateCacheEntry, bool) {
	e, ok := s.aggregateCache[key]
	if ok {
		s.aggregateSequence++
		e.use = s.aggregateSequence
		s.aggregateCache[key] = e
	}
	return e, ok
}
func configKey(r benchdb.Result) string {
	revision, asOf := "", ""
	if r.Source != nil {
		revision = r.Source.Revision
		asOf = r.Source.AsOf
		first := strings.SplitN(revision, "/", 2)[0]
		_, hexErr := hex.DecodeString(first)
		if len(first) == 40 && hexErr == nil {
			revision = first
		}
	}
	if qualified(r.Source) {
		return string(encode([]string{r.Engine, r.Source.Repository, revision, asOf}))
	}
	return string(encode([]string{r.Engine, r.Version, r.Backend, revision, asOf}))
}
func positive(p *float64, status string) (float64, bool) {
	if p == nil || status != "ok" || *p <= 0 || math.IsNaN(*p) || math.IsInf(*p, 0) {
		return 0, false
	}
	return *p, true
}
func loadAggregateSnapshot(ctx context.Context, q queryer, pid int64) (*aggregateSnapshot, error) {
	out := &aggregateSnapshot{engines: map[string]*aggregateConfiguration{}}
	configs := map[string]*aggregateConfiguration{}
	rows, e := q.QueryContext(ctx, "SELECT "+projection+" FROM latest b"+joins+"WHERE b.platform_id=? ORDER BY w.name,e.name,o.phase", pid)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	for rows.Next() {
		_, r, e := scanResult(rows)
		if e != nil {
			return nil, e
		}
		key := configKey(r)
		cfg := configs[key]
		clock := r.CapturedAt
		if r.Source != nil {
			clock = r.Source.AsOf
		}
		if cfg == nil {
			cfg = &aggregateConfiguration{key: key, engine: r.Engine, version: r.Version, backend: r.Backend, clock: clock, source: r.Source, qualified: qualified(r.Source), passed: r.Status == "ok"}
			configs[key] = cfg
			out.bytes += 256 + len(key) + len(r.Version) + len(r.Backend)
		} else {
			if later(clock, cfg.clock) {
				cfg.clock = clock
			}
			if r.Status == "ok" && !cfg.passed {
				cfg.version = r.Version
				cfg.backend = r.Backend
				cfg.passed = true
			}
		}
		if strings.HasPrefix(r.Workload, "features/") || strings.HasPrefix(r.Workload, "mechanisms/") {
			continue
		}
		group := ""
		if r.Display != nil {
			group = r.Display.Group
		}
		if group == "" {
			parts := strings.Split(r.Workload, "/")
			if len(parts) > 1 {
				group = parts[1]
			}
			if group == "" {
				group = "Other workloads"
			}
		}
		v := aggregateScalar{cfg: cfg, workload: r.Workload, contract: r.Contract, group: group, phase: r.Phase, capturedAt: r.CapturedAt, passed: r.Status == "ok"}
		v.latency, v.latOK = positive(r.Value, r.Status)
		v.memory, v.memOK = positive(r.PeakRSS, r.MemoryStatus)
		v.code, v.codeOK = positive(r.CodeBytes, r.CodeStatus)
		out.rows = append(out.rows, v)
		out.bytes += 192 + len(v.workload) + len(v.contract) + len(v.group) + len(v.capturedAt)
	}
	if e = rows.Err(); e != nil {
		return nil, e
	}
	for _, cfg := range configs {
		old := out.engines[cfg.engine]
		if preferConfiguration(cfg, old) {
			out.engines[cfg.engine] = cfg
		}
	}
	selected := out.rows[:0]
	for _, r := range out.rows {
		if out.engines[r.cfg.engine] == r.cfg {
			selected = append(selected, r)
		}
	}
	out.rows = selected
	return out, nil
}
func metricPhase(metric string) (string, string) {
	switch metric {
	case "compile":
		return "compile", "latency"
	case "inst", "instantiate":
		return "instantiate", "latency"
	case "first", "first-call":
		return "first-call", "latency"
	case "steady":
		return "steady", "latency"
	case "rssCompile":
		return "compile", "memory"
	case "rssInst":
		return "instantiate", "memory"
	case "rssFirst":
		return "first-call", "memory"
	case "rss":
		return "steady", "memory"
	case "rssAverage":
		return "*", "memory"
	case "code":
		return "compile", "code"
	}
	return "", ""
}
func normalizedAggregateQuery(q AggregateQuery) (AggregateQuery, error) {
	if q.Metric == "" {
		q.Metric = "steady"
	}
	if q.Weighting == "" {
		q.Weighting = "corpus"
	}
	if q.Cohort == "" {
		q.Cohort = "shared"
	}
	if q.Average == "" {
		q.Average = "geo"
	}
	_, kind := metricPhase(q.Metric)
	if kind == "" || q.Weighting != "corpus" && q.Weighting != "workload" || q.Cohort != "shared" && q.Cohort != "per-engine" || q.Average != "geo" && q.Average != "mean" || len(q.Engines) > 128 {
		return q, wire.Invalid("invalid aggregate selection")
	}
	seen := map[string]bool{}
	engines := []string{}
	for _, engine := range q.Engines {
		if !wire.IsIdentity(engine) {
			return q, wire.Invalid("invalid aggregate engine")
		}
		if !seen[engine] {
			engines = append(engines, engine)
			seen[engine] = true
		}
	}
	sort.Strings(engines)
	q.Engines = engines
	if q.Baseline != "" && !wire.IsIdentity(q.Baseline) {
		return q, wire.Invalid("invalid baseline")
	}
	return q, nil
}
func cloneAggregate(r AggregateResult) AggregateResult {
	r.Participants = append([]string(nil), r.Participants...)
	r.Workloads = append([]string(nil), r.Workloads...)
	r.Cards = append([]AggregateCard(nil), r.Cards...)
	for i := range r.Cards {
		c := &r.Cards[i]
		if c.Value != nil {
			v := *c.Value
			c.Value = &v
		}
		if c.Ratio != nil {
			v := *c.Ratio
			c.Ratio = &v
		}
		if c.Source != nil {
			v := *c.Source
			c.Source = &v
		}
	}
	return r
}

// Aggregate loads latest scalar cells once per platform revision. Ordered samples
// are never read for cards; both scalar and policy caches have a strict memory cap.
func (s *Store) Aggregate(ctx context.Context, q AggregateQuery) (AggregateResult, error) {
	q, e := normalizedAggregateQuery(q)
	if e != nil {
		return AggregateResult{}, e
	}
	s.aggregateMu.Lock()
	defer s.aggregateMu.Unlock()
	tx, e := s.reader.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if e != nil {
		return AggregateResult{}, e
	}
	defer tx.Rollback()
	pid, e := platformLookup(ctx, tx, q.Platform)
	if e != nil {
		return AggregateResult{}, e
	}
	rev, e := revision(ctx, tx, fmt.Sprint("latest-revision/", pid))
	if e != nil {
		return AggregateResult{}, e
	}
	key := "aggregate/" + rev + "/" + hash(q)
	if cached, ok := s.aggregateHit(key); ok {
		return cloneAggregate(*cached.result), nil
	}
	snapshotKey := "snapshot/" + q.Platform + "/" + rev
	var snapshot *aggregateSnapshot
	if cached, ok := s.aggregateHit(snapshotKey); ok {
		snapshot = cached.snapshot
	} else {
		snapshot, e = loadAggregateSnapshot(ctx, tx, pid)
		if e != nil {
			return AggregateResult{}, e
		}
		s.aggregateRemember(snapshotKey, aggregateCacheEntry{snapshot: snapshot, bytes: snapshot.bytes})
	}
	result := computeAggregate(snapshot, q)
	result.Revision = rev
	result.Platform = q.Platform
	result.Metric = q.Metric
	s.aggregateRemember(key, aggregateCacheEntry{result: &result, bytes: len(encode(result))})
	return cloneAggregate(result), nil
}
func computeAggregate(data *aggregateSnapshot, q AggregateQuery) AggregateResult {
	out := AggregateResult{Participants: []string{}, Cards: []AggregateCard{}}
	workloads := map[string]bool{}
	for _, r := range data.rows {
		workloads[r.workload] = true
	}
	out.Workloads = []string{}
	for w := range workloads {
		out.Workloads = append(out.Workloads, w)
	}
	sort.Strings(out.Workloads)
	selected := append([]string(nil), q.Engines...)
	if len(selected) == 0 {
		for engine := range data.engines {
			selected = append(selected, engine)
		}
		sort.Strings(selected)
	}
	phase, kind := metricPhase(q.Metric)
	cells := map[string]map[string]aggregateScalar{}
	for _, row := range data.rows {
		if phase != "*" && row.phase != phase {
			continue
		}
		key := row.workload + "|" + row.contract
		if phase == "*" {
			key += "|" + row.phase
		}
		if cells[key] == nil {
			cells[key] = map[string]aggregateScalar{}
		}
		cells[key][row.cfg.engine] = row
	}
	available := func(row aggregateScalar) (float64, bool) {
		switch kind {
		case "memory":
			return row.memory, row.memOK
		case "code":
			return row.code, row.codeOK
		default:
			return row.latency, row.latOK
		}
	}
	has := func(engine string) bool {
		for _, rows := range cells {
			if _, ok := available(rows[engine]); ok {
				return true
			}
		}
		return false
	}
	participants := []string{}
	for _, engine := range selected {
		if has(engine) {
			participants = append(participants, engine)
		}
	}
	out.Participants = append(out.Participants, participants...)
	availability := map[string]map[string]bool{}
	for key, rows := range cells {
		availability[key] = map[string]bool{}
		for engine, row := range rows {
			_, ok := available(row)
			availability[key][engine] = ok
		}
	}
	passing := map[string]map[string]bool{}
	for _, row := range data.rows {
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
	reference := map[string]bool{}
	if q.Cohort == "shared" {
		if anchor == "" {
			anchor = leastCoveredEngine(participants, availability)
			for key, rows := range availability {
				if rows[anchor] {
					reference[key] = true
				}
			}
		} else {
			for key, rows := range cells {
				for _, row := range rows {
					if passing[row.workload+"|"+row.contract][anchor] && (phase != "*" || availability[key][anchor]) {
						reference[key] = true
					}
					break
				}
			}
		}
	}

	calculate := func(engine string) AggregateCard {
		card := AggregateCard{Engine: engine}
		if cfg := data.engines[engine]; cfg != nil {
			card.Version = cfg.version
			card.Backend = cfg.backend
			card.Source = cfg.source
		}
		values := []float64{}
		groups := []string{}
		keys := make([]string, 0, len(cells))
		for key := range cells {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			rows := cells[key]
			row := rows[engine]
			v, ok := available(row)
			if !ok {
				continue
			}
			if q.Cohort == "shared" && !reference[key] {
				continue
			}

			values = append(values, v)
			groups = append(groups, row.group)
			if card.LatestCreated == "" || later(row.capturedAt, card.LatestCreated) {
				card.LatestCreated = row.capturedAt
			}
		}
		card.Count = len(values)
		if q.Cohort == "shared" && len(values) != len(reference) {
			return card
		}
		if card.Count > 0 {
			value := 0.0
			if phase == "*" {
				for _, v := range values {
					value += v / float64(len(values))
				}
			} else {
				counts := map[string]int{}
				for _, g := range groups {
					counts[g]++
				}
				for i, v := range values {
					weight := 1.0 / float64(len(values))
					if q.Weighting == "corpus" {
						weight = 1.0 / float64(len(counts)*counts[groups[i]])
					}
					if q.Average == "mean" {
						value += weight * v
					} else {
						value += weight * math.Log(v)
					}
				}
				if q.Average != "mean" {
					value = math.Exp(value)
				}
			}
			if !math.IsNaN(value) && !math.IsInf(value, 0) {
				card.Value = &value
			}
		}
		return card
	}
	cards := map[string]AggregateCard{}
	for _, engine := range selected {
		cards[engine] = calculate(engine)
	}
	if q.Baseline != "" {
		if _, ok := cards[q.Baseline]; !ok {
			cards[q.Baseline] = calculate(q.Baseline)
		}
	}
	baseline := cards[q.Baseline]
	for _, engine := range selected {
		card := cards[engine]
		if card.Value != nil {
			if engine == q.Baseline {
				ratio := 1.0
				card.Ratio = &ratio
			} else if baseline.Value != nil && (q.Cohort == "per-engine" || phase == "*" || contains(participants, q.Baseline)) {
				ratio := *card.Value / *baseline.Value
				if !math.IsInf(ratio, 0) && !math.IsNaN(ratio) {
					card.Ratio = &ratio
				}
			}
		}
		out.Cards = append(out.Cards, card)
	}
	return out
}
func contains(values []string, needle string) bool {
	for _, v := range values {
		if v == needle {
			return true
		}
	}
	return false
}

// At an identical source timestamp, prefer an explicitly identified requested
// Wasm pipeline over its older generic optimizing-tier presentation. Older
// observations remain stored and accessible; a newer source always wins.
func preferConfiguration(cfg, old *aggregateConfiguration) bool {
	if old == nil {
		return true
	}
	if cfg.qualified != old.qualified {
		return cfg.qualified
	}
	if later(cfg.clock, old.clock) {
		return true
	}
	if later(old.clock, cfg.clock) {
		return false
	}
	if cfg.engine == "v8" && old.engine == "v8" && cfg.source != nil && old.source != nil && cfg.source.Repository == old.source.Repository && cfg.source.Revision == old.source.Revision && (cfg.backend == "turboshaft") != (old.backend == "turboshaft") {
		return cfg.backend == "turboshaft"
	}
	return cfg.key < old.key
}

// A stable minimum-pass engine defines the reference instead of intersecting all engines.
func leastCoveredEngine(engines []string, cells map[string]map[string]bool) string {
	anchor := ""
	best := 0
	for _, engine := range engines {
		count := 0
		for _, rows := range cells {
			if rows[engine] {
				count++
			}
		}
		if count > 0 && (anchor == "" || count < best || count == best && engine < anchor) {
			anchor = engine
			best = count
		}
	}
	return anchor
}
