package store

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/comparison"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

type CohortSelector struct {
	Definition string `json:"definition"`
	Method     string `json:"method"`
	Analysis   string `json:"analysis"`
}
type CohortScope struct {
	Revision            string           `json:"revision"`
	Selection           string           `json:"selection"`
	Environment         string           `json:"environment"`
	Lanes               []string         `json:"lanes"`
	LaneKind            string           `json:"laneKind"`
	Baseline            string           `json:"baseline"`
	Selectors           []CohortSelector `json:"selectors"`
	Policy              string           `json:"policy"`
	Weighting           string           `json:"weighting"`
	Workloads           string           `json:"workloads"`
	MixedConfigurations string           `json:"mixedConfigurations"`
	Collectors          string           `json:"collectors"`
	Definitions         string           `json:"definitions"`
	Contracts           string           `json:"contracts"`
}
type Cohort struct {
	Scope             CohortScope       `json:"scope"`
	Digest            string            `json:"digest"`
	CategoryPolicy    string            `json:"categoryPolicy"`
	EligibilityPolicy string            `json:"eligibilityPolicy"`
	Excluded          map[string]int    `json:"excluded"`
	Comparison        comparison.Output `json:"comparison"`
}

func (s *Store) NormalizeCohort(scope CohortScope) (CohortScope, error) {
	if scope.Revision == "" {
		scope.Revision = s.Current()
	}
	if !wire.IsHash(scope.Revision) || !wire.IsHash(scope.Environment) || !wire.IsHash(scope.Baseline) {
		return scope, wire.Invalid("cohort requires exact revision, environment and baseline")
	}
	if _, e := s.Revision(scope.Revision); e != nil {
		return scope, e
	}
	if scope.Selection == "" || scope.Selection == "s1" {
		scope.Selection = "current"
	}
	if scope.Selection == "s2" {
		scope.Selection = "previous"
	}
	if scope.Selection != "current" && scope.Selection != "previous" {
		return scope, wire.Invalid("invalid cohort selection")
	}
	if scope.LaneKind != "configuration" && scope.LaneKind != "track" {
		return scope, wire.Invalid("invalid cohort lane kind")
	}
	if scope.MixedConfigurations != "reject" && scope.MixedConfigurations != "explicit-membership" {
		return scope, wire.Invalid("explicit mixed configuration policy required")
	}
	if scope.Collectors != "require-recorded" && scope.Collectors != "allow-unrecorded-timing" && scope.Collectors != "allow-unrecorded-native-size" {
		return scope, wire.Invalid("explicit collector policy required")
	}
	if scope.Definitions != "require-registered" && scope.Definitions != "allow-unregistered-native-size" {
		return scope, wire.Invalid("explicit definition policy required")
	}
	if scope.Contracts != "latest-in-scope" && scope.Contracts != "all-exact-contracts" {
		return scope, wire.Invalid("explicit workload contract policy required")
	}
	if scope.Workloads != "applications" && scope.Workloads != "all" {
		return scope, wire.Invalid("explicit workload population required")
	}
	if scope.Weighting != "workload" && scope.Weighting != "corpus" {
		return scope, wire.Invalid("invalid cohort weighting")
	}
	if scope.Policy != "shared-geometric-v1" && scope.Policy != "available-rss-arithmetic-v1" && scope.Policy != "matched-rss-arithmetic-v1" {
		return scope, wire.Invalid("invalid cohort policy")
	}
	if len(scope.Lanes) == 0 || len(scope.Lanes) > 32 || len(scope.Selectors) == 0 || len(scope.Selectors) > 4 || (scope.Policy == "shared-geometric-v1" && len(scope.Selectors) != 1) || (scope.Policy != "shared-geometric-v1" && scope.Weighting != "workload") {
		return scope, wire.Invalid("invalid cohort scope bounds")
	}
	scope.Lanes = append([]string{}, scope.Lanes...)
	sort.Strings(scope.Lanes)
	found := false
	for i, id := range scope.Lanes {
		if !wire.IsHash(id) || (i > 0 && id == scope.Lanes[i-1]) {
			return scope, wire.Invalid("invalid or duplicate cohort lane")
		}
		if id == scope.Baseline {
			found = true
		}
	}
	if !found {
		return scope, wire.Invalid("baseline must be explicitly requested")
	}
	scope.Selectors = append([]CohortSelector{}, scope.Selectors...)
	sort.Slice(scope.Selectors, func(i, j int) bool {
		a, _ := wire.Encode(scope.Selectors[i])
		b, _ := wire.Encode(scope.Selectors[j])
		return string(a) < string(b)
	})
	for i, v := range scope.Selectors {
		if !wire.IsHash(v.Definition) || !wire.IsHash(v.Method) || v.Analysis == "" || len(v.Analysis) > 256 || (i > 0 && v == scope.Selectors[i-1]) {
			return scope, wire.Invalid("invalid or duplicate measurement selector")
		}
	}
	return scope, nil
}

func (s *Store) ComputeCohort(ctx context.Context, scope CohortScope) (Cohort, error) {
	c := Cohort{CategoryPolicy: comparison.CategoryVersion, EligibilityPolicy: "wasmfyi-summary-eligibility-v1", Excluded: map[string]int{}}
	if e := ctx.Err(); e != nil {
		return c, e
	}
	var e error
	scope, e = s.NormalizeCohort(scope)
	if e != nil {
		return c, e
	}
	c.Scope = scope
	if _, e = s.Record(scope.Revision, "environment", scope.Environment); e != nil {
		return c, e
	}
	requested := map[string]bool{}
	for _, id := range scope.Lanes {
		if _, e = s.Record(scope.Revision, scope.LaneKind, id); e != nil {
			return c, e
		}
		requested[id] = true
	}
	rows := map[string]*comparison.Row{}
	configurations := map[string]map[string]bool{}
	contracts := map[string]string{}
	decoded, total := 0, 0
	type activeContract struct {
		ID        string
		Created   time.Time
		Ambiguous bool
	}
	active := map[string]activeContract{}
	for _, selector := range scope.Selectors {
		definition, e := s.Record(scope.Revision, "metric", selector.Definition)
		if e != nil {
			return c, e
		}
		var metric struct {
			Name, Unit string
			Status     string
			Version    int
		}
		if e = json.Unmarshal(definition.Data, &metric); e != nil {
			return c, e
		}
		if metric.Status == "unregistered" && !(metric.Name == "native.code_size" && scope.Definitions == "allow-unregistered-native-size") {
			return c, wire.Invalid("cohort metric definition not registered")
		}
		method, e := s.cohortMethod(ctx, scope.Revision, selector)
		if e != nil {
			return c, e
		}
		if method.Status != "available" {
			return c, wire.Invalid("cohort method lacks source recipe")
		}
		if method.Metric != metric.Name {
			return c, wire.Invalid("cohort method differs from metric definition")
		}
		if method.CollectorStatus != "recorded" && !(metric.Name == "time.wall" && scope.Collectors == "allow-unrecorded-timing") && !(strings.HasPrefix(metric.Name, "native.") && scope.Collectors == "allow-unrecorded-native-size") {
			return c, wire.Invalid("cohort collector not recorded")
		}
		for _, o := range method.Observations {
			if o.DefinitionVersion <= 0 || o.DefinitionVersion != metric.Version || o.Unit != metric.Unit || o.Scope == "" || o.Phase == "" || o.Collector == "" || o.CollectorVersion == "" || o.Quality == "" || o.Profile == "" || o.Denominator == "" {
				return c, wire.Invalid("cohort observer identity incomplete or inconsistent")
			}
		}
		if scope.Policy != "shared-geometric-v1" && (metric.Name != "process.rss" || metric.Unit != "bytes") {
			return c, wire.Invalid("RSS policy requires current process RSS definitions")
		}
		selected, e := s.ResultsContext(ctx, Query{Revision: scope.Revision, Selection: scope.Selection, Environment: scope.Environment, Definition: selector.Definition, Method: selector.Method}, false)
		if e != nil {
			return c, e
		}
		for _, record := range selected {
			if e = ctx.Err(); e != nil {
				return c, e
			}
			decoded += len(record.Data)
			if decoded > 32<<20 {
				return c, ErrLimit
			}
			var v wire.Result
			if e = wire.Decode(record.Data, &v); e != nil {
				return c, e
			}
			if e = wire.ValidateMetricBinding(v, definition.Data); e != nil {
				return c, e
			}

			lane := v.ConfigurationID
			if scope.LaneKind == "track" {
				lane = v.TrackID
			}
			if !requested[lane] {
				continue
			}
			if v.AnalysisVersion != selector.Analysis {
				return c, wire.Invalid("cohort crosses requested analysis version")
			}
			if scope.Workloads == "applications" && strings.HasPrefix(v.Workload, "features/") {
				c.Excluded["feature-probe"]++
				continue
			}
			// Latest contracts are selected only from the requested lane/workload
			// population. Unrelated captures must not supersede or poison it.
			if v.AnalysisVersion == selector.Analysis {
				prior := active[v.Workload]
				if prior.ID == "" || v.Created.After(prior.Created) {
					active[v.Workload] = activeContract{ID: v.ContractID, Created: v.Created}
				} else if v.Created.Equal(prior.Created) && prior.ID != v.ContractID {
					prior.Ambiguous = true
					active[v.Workload] = prior
				}
			}
			if v.MeasurementMethod == nil || v.MeasurementMethod.Status != "available" {
				return c, wire.Invalid("cohort method lacks source recipe")
			}
			m := v.MeasurementMethod
			if m.CollectorStatus != "recorded" && !(metric.Name == "time.wall" && scope.Collectors == "allow-unrecorded-timing") && !(strings.HasPrefix(metric.Name, "native.") && scope.Collectors == "allow-unrecorded-native-size") {
				return c, wire.Invalid("cohort collector not recorded")
			}
			if configurations[lane] == nil {
				configurations[lane] = map[string]bool{}
			}
			configurations[lane][v.ConfigurationID] = true
			if scope.MixedConfigurations == "reject" && len(configurations[lane]) > 1 {
				return c, wire.Invalid("track contains mixed exact configurations")
			}
			group, ok := contracts[v.ContractID]
			if !ok {
				workload, e := s.Record(scope.Revision, "workload", v.ContractID)
				if e != nil {
					return c, e
				}
				var w struct {
					ID         string
					Features   []string
					Provenance struct{ Category, Feature string }
					Original   struct{ Tags []string } `json:"original_contract"`
				}
				if e = json.Unmarshal(workload.Data, &w); e != nil {
					return c, e
				}
				group, ok = comparison.Category(w.ID, w.Provenance.Category, w.Provenance.Feature, w.Features, w.Original.Tags)
				if !ok && scope.Weighting == "corpus" {
					return c, wire.Invalid("corpus weighting lacks editorial category")
				}
				if len(group) > 256 {
					return c, wire.Invalid("editorial category exceeds ceiling")
				}
				contracts[v.ContractID] = group
			}
			keyBytes, _ := wire.Encode([]string{v.ContractID, selector.Definition, selector.Method, selector.Analysis})
			key := wire.Hash(keyBytes)
			row := rows[key]
			if row == nil {
				row = &comparison.Row{Key: key, Workload: v.Workload, Group: group, Cells: []comparison.Cell{}}
				rows[key] = row
			}
			for _, prior := range row.Cells {
				if prior.Configuration == lane {
					return c, wire.Invalid("ambiguous selected workload within lane")
				}
			}
			status, reason, e := s.cohortEligibility(scope.Revision, v)
			if e != nil {
				return c, e
			}
			var number *float64
			approximate := false
			var sourceSummary map[string]json.RawMessage
			if e = json.Unmarshal(v.Summary, &sourceSummary); e != nil {
				return c, e
			}
			if n, ok := value(record); ok {
				f, exact := n.Float64()
				approximate = !exact
				if f > 0 && !math.IsNaN(f) && !math.IsInf(f, 0) {
					number = &f
				}
			}
			if number == nil && status == "ok" {
				status = "unavailable"
				reason = "nonpositive-or-unavailable-value"
			}
			if status != "ok" {
				c.Excluded[reason]++
			}
			groupID := ""
			if v.SamplingGroup != nil {
				groupID = v.SamplingGroup.ID
			}
			row.Cells = append(row.Cells, comparison.Cell{Configuration: lane, ExactConfiguration: v.ConfigurationID, Contract: v.ContractID, Definition: v.MetricDefinitionID, Method: v.MeasurementMethodID, SamplingGroup: groupID, Result: record.ID, Report: v.ReportID, Status: status, Value: number, SourceValue: sourceSummary[v.Statistic], ApproximateValue: approximate})
			total++
			if total > comparison.MaxCells || len(rows) > 10000 {
				return c, ErrLimit
			}
		}
	}
	ordered := []comparison.Row{}
	if scope.Contracts == "latest-in-scope" {
		for _, v := range active {
			if v.Ambiguous {
				return c, wire.Invalid("latest workload contract timestamp is ambiguous")
			}
		}
	}
	for _, r := range rows {
		if scope.Contracts == "latest-in-scope" && len(r.Cells) > 0 && r.Cells[0].Contract != active[r.Workload].ID {
			c.Excluded["superseded-contract"] += len(r.Cells)
			continue
		}
		sort.Slice(r.Cells, func(i, j int) bool { return r.Cells[i].Configuration < r.Cells[j].Configuration })
		ordered = append(ordered, *r)
	}
	sort.Slice(ordered, func(i, j int) bool {
		if ordered[i].Workload != ordered[j].Workload {
			return ordered[i].Workload < ordered[j].Workload
		}
		return ordered[i].Key < ordered[j].Key
	})
	c.Comparison, e = comparison.Compute(ctx, comparison.Input{Configurations: scope.Lanes, Baseline: scope.Baseline, Weighting: scope.Weighting, Policy: scope.Policy, Rows: ordered})
	if e != nil {
		return c, wire.Invalid(e.Error())
	}
	b, _ := wire.Encode(struct {
		Scope   CohortScope
		Version string
		Rows    []comparison.Row
	}{scope, comparison.Version, ordered})
	c.Digest = wire.Hash(b)
	return c, nil
}

func (s *Store) cohortEligibility(revision string, v wire.Result) (string, string, error) {
	var summary struct {
		Outcomes      map[string]int
		LatencyStatus string `json:"latency_status"`
		Samples       int    `json:"sample_count"`
		Launches      int    `json:"independent_launches"`
		Status        string
	}
	if json.Unmarshal(v.Summary, &summary) != nil {
		return "unavailable", "malformed-summary", nil
	}
	switch v.Metric {
	case "time.wall":
		if summary.LatencyStatus != "timing_pass" || v.Scenario == "harness-calibration" {
			return "unavailable", "non-headline-timing", nil
		}
		report, e := s.Record(revision, "report", v.ReportID)
		if e != nil {
			return "", "", e
		}
		var policy struct {
			Headline struct{ Status string } `json:"headlineLatencyPolicy"`
		}
		_ = json.Unmarshal(report.Data, &policy)
		if policy.Headline.Status != "timing_pass" {
			return "unavailable", "headline-latency-policy-unavailable", nil
		}
		for status, n := range summary.Outcomes {
			if n > 0 && status != "ok" && status != "unsupported" {
				return "unavailable", "failed-launch", nil
			}
		}
		if summary.Outcomes["ok"] <= 0 || summary.LatencyStatus == "failed_cell" || summary.Samples <= 0 || summary.Launches <= 0 {
			return "unavailable", "no-eligible-timing-launches", nil
		}
		if v.Scenario == "compile" && (v.Runtime == "wazero" || strings.HasPrefix(v.Runtime, "v8-")) {
			r, e := s.Record(revision, "configuration", v.ConfigurationID)
			if e != nil {
				return "", "", e
			}
			var config struct {
				Description struct {
					Effective map[string]json.RawMessage `json:"effective_configuration"`
				}
			}
			if json.Unmarshal(r.Data, &config) != nil {
				return "unavailable", "configuration-unavailable", nil
			}
			audited := false
			if v.Runtime == "wazero" {
				var policy string
				_ = json.Unmarshal(config.Description.Effective["compile_policy"], &policy)
				audited = strings.HasPrefix(policy, "fresh uncached module per operation;")
			} else {
				var flags string
				_ = json.Unmarshal(config.Description.Effective["flags"], &flags)
				var list []string
				_ = json.Unmarshal([]byte(flags), &list)
				for _, f := range list {
					if f == "--no-wasm-native-module-cache" {
						audited = true
					}
				}
			}
			if !audited {
				return "unavailable", "uncached-compile-policy-unavailable", nil
			}
		}
	case "process.rss", "process.peak_rss":
		var recipe struct{ Options struct{ Launches int } }
		_ = json.Unmarshal(v.MeasurementMethod.Recipe, &recipe)
		if summary.Launches <= 0 || recipe.Options.Launches != summary.Launches {
			return "unavailable", "incomplete-memory-launch-coverage", nil
		}
	default:
		if !strings.HasPrefix(v.Metric, "native.") || summary.Status != "available" {
			return "unavailable", "unsupported-headline-metric", nil
		}
	}
	return "ok", "", nil
}

func (s *Store) cohortMethod(ctx context.Context, revision string, selector CohortSelector) (*wire.MeasurementMethod, error) {
	rev, e := s.Revision(revision)
	if e != nil {
		return nil, e
	}
	set, e := s.indexGet(rev.Indexes, indexKey("methods", selector.Method, selector.Definition))
	if e != nil {
		return nil, e
	}
	if set.Count == 0 {
		// Before the dedicated catalog existed, descriptors were already in the
		// method/cell postings. A bounded legacy lookup keeps those views usable.
		rows, e := s.ResultsContext(ctx, Query{Revision: revision, Method: selector.Method, Definition: selector.Definition}, true)
		if e != nil {
			return nil, e
		}
		if len(rows) == 0 {
			return nil, ErrNotFound
		}
		var v wire.Result
		if e = wire.Decode(rows[0].Data, &v); e != nil {
			return nil, e
		}
		return v.MeasurementMethod, nil
	}
	var method *wire.MeasurementMethod
	stop := errors.New("method located")
	budget := ScanLimit
	e = s.walk(set.Root, &budget, func(_, digest string) error {
		if e := ctx.Err(); e != nil {
			return e
		}
		var r wire.Record
		if e := s.load(digest, &r); e != nil {
			return e
		}
		var v wire.Result
		if e := wire.Decode(r.Data, &v); e != nil {
			return e
		}
		if v.MeasurementMethod == nil || v.MeasurementMethodID != selector.Method || v.MetricDefinitionID != selector.Definition {
			return wire.Invalid("corrupt method catalog")
		}
		method = v.MeasurementMethod
		return stop
	})
	if e != nil && e != stop {
		return nil, e
	}
	if method == nil {
		return nil, ErrNotFound
	}
	return method, nil
}

// MethodContext resolves only descriptors admitted into the selected publication.
// The metric definition disambiguates the small persistent method posting set.
func (s *Store) MethodContext(ctx context.Context, revision, definition, method string) (*wire.MeasurementMethod, error) {
	if !wire.IsHash(definition) || !wire.IsHash(method) {
		return nil, wire.Invalid("exact definition and method digests required")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return s.cohortMethod(ctx, revision, CohortSelector{Definition: definition, Method: method})
}
