package api

// Page preparation is an offline read, not an HTTP request. It uses the same
// complete-scope selection and comparison handlers as the API, without doing
// expensive discovery during a visitor's first render.
import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"

	"github.com/JairusSW/wasm.fyi/service/internal/comparison"
	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

type pageResponse struct {
	bytes.Buffer
	header http.Header
	status int
}

func (w *pageResponse) Header() http.Header { return w.header }
func (w *pageResponse) WriteHeader(n int)   { w.status = n }
func (w *pageResponse) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = 200
	}
	return w.Buffer.Write(b)
}

type PageBuilder struct {
	api      *API
	Revision string
}

func NewPageBuilder(s *store.Store, key []byte) *PageBuilder {
	a := &API{Store: s, CursorKey: key, cohorts: &cohortCache{entries: map[string]*store.Cohort{}}, results: &resultCache{entries: map[string]resultCacheEntry{}}, calculating: make(chan struct{}, 2), selecting: make(chan struct{}, 2)}
	return &PageBuilder{api: a, Revision: s.Current()}
}
func (b *PageBuilder) read(ctx context.Context, path string, p url.Values) (json.RawMessage, error) {
	r, _ := http.NewRequestWithContext(ctx, "GET", "http://offline/api/v1/"+path+"?"+p.Encode(), nil)
	w := &pageResponse{header: make(http.Header)}
	switch path {
	case "availability":
		b.api.availability(w, r, b.Revision, true)
	case "matrix":
		b.api.matrix(w, r, b.Revision, 25, cursor{}, true)
	case "overview":
		b.api.cohort(w, r, path, p)
	default:
		return nil, fmt.Errorf("unsupported page preparation resource")
	}
	if w.status != 200 {
		return nil, fmt.Errorf("prepare %s: HTTP %d: %s", path, w.status, w.String())
	}
	return append(json.RawMessage(nil), w.Bytes()...), nil
}

// Display catalogs omit machine probes, original contracts and tool inventories.
// Exact metadata remains available through its referenced API record.
func (b *PageBuilder) DisplayCatalog(ctx context.Context, kind string) ([]wire.Record, error) {
	records, err := b.api.Store.CatalogContext(ctx, b.Revision, kind)
	if err != nil {
		return nil, err
	}
	fields := map[string][]string{
		"environment": {"os", "arch", "hostname", "cpu_description", "kernel", "policy"},
		"track":       {"sourceRuntimeId", "backend", "name"},
		"workload":    {"id", "sha256", "bytes", "features", "abi", "reset", "units_per_invocation", "work_unit", "evidence_scope", "source"},
	}[kind]
	for i := range records {
		var source map[string]any
		if err = json.Unmarshal(records[i].Data, &source); err != nil {
			return nil, err
		}
		display := map[string]any{}
		for _, key := range fields {
			if v, ok := source[key]; ok {
				display[key] = v
			}
		}
		if kind == "workload" {
			if p, ok := source["provenance"].(map[string]any); ok {
				small := map[string]any{}
				for _, k := range []string{"category", "feature", "scope", "baseline"} {
					if v, ok := p[k]; ok {
						small[k] = v
					}
				}
				display["provenance"] = small
			}
			if p, ok := source["original_contract"].(map[string]any); ok {
				small := map[string]any{}
				for _, k := range []string{"desc", "tags"} {
					if v, ok := p[k]; ok {
						small[k] = v
					}
				}
				display["original_contract"] = small
			}
		}
		records[i].Data, err = json.Marshal(display)
		if err != nil {
			return nil, err
		}
	}
	return records, nil
}

type PageSeed struct {
	Statistics   *PageStatistics            `json:"statistics,omitempty"`
	Schema       int                        `json:"schema"`
	Revision     string                     `json:"revision"`
	Machine      string                     `json:"machine"`
	Environment  string                     `json:"environment"`
	Environments []string                   `json:"members"`
	Catalogs     map[string][]wire.Record   `json:"catalogs"`
	Availability json.RawMessage            `json:"availability"`
	Overviews    map[string]json.RawMessage `json:"overviews"`
	Matrix       json.RawMessage            `json:"matrix,omitempty"`
	Baseline     string                     `json:"baseline"`
}

// DefaultPage includes headlines and, optionally, one table page. It never
// embeds historical points, observations, trial arrays or artifact contents.
func (b *PageBuilder) DefaultPage(ctx context.Context, machine, anchor string, members []string, catalogs map[string][]wire.Record, table bool) (PageSeed, error) {
	seed := PageSeed{Schema: 1, Revision: b.Revision, Machine: machine, Environment: anchor, Environments: members, Catalogs: catalogs, Overviews: map[string]json.RawMessage{}, Baseline: "A"}
	membership, _ := json.Marshal(members)
	p := url.Values{"environment": {anchor}, "selection": {"current"}, "environments": {string(membership)}}
	if len(members) == 0 {
		p.Del("environments")
	}
	var err error
	merged := map[string]*availableLane{}
	slots := map[string]string{"wasmtime": "A", "wasmer-singlepass": "D", "wazero": "E", "v8": "F", "wago": "G", "wavm": "L", "wasm2c-gcc": "T", "w2c2-gcc": "U"}
	lanes := []string{}
	baseline := ""
	for _, t := range catalogs["tracks"] {
		var d struct {
			Source string `json:"sourceRuntimeId"`
		}
		_ = json.Unmarshal(t.Data, &d)
		if slot := slots[d.Source]; slot != "" {
			lanes = append(lanes, t.ID)
			if slot == "A" {
				baseline = t.ID
			}
		}
	}
	if baseline == "" {
		return seed, fmt.Errorf("default baseline unavailable")
	}
	sort.Strings(lanes)
	definitions := []struct{ label, metric, scenario, statistic string }{{"compile", "time.wall", "compile", "median_ns_per_operation"}, {"steady", "time.wall", "steady", "median_ns_per_operation"}, {"rss", "process.peak_rss", "steady", "median_bytes"}, {"code", "native.code_size", "compile", "size_bytes"}}
	if table {
		definitions = append(definitions, struct{ label, metric, scenario, statistic string }{"inst", "time.wall", "instantiate", "median_ns_per_operation"}, struct{ label, metric, scenario, statistic string }{"first", "time.wall", "first-call", "median_ns_per_operation"})
	}
	for _, d := range definitions {
		part := url.Values{}
		for k, v := range p {
			part[k] = append([]string(nil), v...)
		}
		part.Set("metric", d.metric)
		part.Set("scenario", d.scenario)
		part.Set("statistic", d.statistic)
		if d.metric == "time.wall" {
			part.Set("profile", "timing")
		}
		payload, e := b.read(ctx, "availability", part)
		if e != nil {
			return seed, e
		}
		var available struct{ Items []availableLane }
		if e = json.Unmarshal(payload, &available); e != nil {
			return seed, e
		}
		for _, lane := range available.Items {
			target := merged[lane.Track]
			if target == nil {
				target = &availableLane{Track: lane.Track, Configurations: []wire.Record{}, Metrics: []availableMetric{}}
				merged[lane.Track] = target
			}
			target.Metrics = append(target.Metrics, lane.Metrics...)
			if d.label == "steady" {
				target.Coverage = lane.Coverage
			}
			for _, c := range lane.Configurations {
				found := false
				for _, old := range target.Configurations {
					if old.ID == c.ID {
						found = true
						break
					}
				}
				if !found {
					target.Configurations = append(target.Configurations, c)
				}
			}
		}
		set := map[store.CohortSelector]bool{}
		selectors := []store.CohortSelector{}
		for _, lane := range available.Items {
			include := false
			for _, id := range lanes {
				if lane.Track == id {
					include = true
				}
			}
			if !include {
				continue
			}
			for _, m := range lane.Metrics {
				if m.Metric == d.metric && m.Scenario == d.scenario && m.Statistic == d.statistic && (d.metric != "time.wall" || m.Profile == "timing") {
					for _, s := range m.Selectors {
						if !set[s] {
							set[s] = true
							selectors = append(selectors, s)
						}
					}
				}
			}
		}
		if len(selectors) == 0 {
			continue
		}
		scope := store.CohortScope{Revision: b.Revision, Environment: anchor, Environments: members, Selection: "current", Lanes: lanes, Baseline: baseline, LaneKind: "track", Selectors: selectors, MethodPolicy: "explicit-source-membership-v1", Policy: "shared-geometric-v1", Weighting: "corpus", Workloads: "all", MixedConfigurations: "explicit-membership", Collectors: "allow-unrecorded-timing", Definitions: "require-registered", Contracts: "latest-in-scope"}
		if d.metric == "time.wall" {
			scope.Workloads = "applications"
		}
		if d.label == "rss" {
			scope.SourcePolicy = "latest-capture-memory-pass-preferred-v1"
			scope.Collectors = "require-recorded"
		}
		if d.label == "code" {
			scope.Collectors = "allow-unrecorded-native-size"
			scope.Definitions = "allow-unregistered-native-size"
		}
		raw, _ := json.Marshal(scope)
		seed.Overviews[d.label], err = b.read(ctx, "overview", url.Values{"scope": {string(raw)}, "version": {comparison.Version}})
		if err != nil {
			return seed, fmt.Errorf("%s: %w", d.label, err)
		}
	}
	combined := []availableLane{}
	for _, lane := range merged {
		combined = append(combined, *lane)
	}
	sort.Slice(combined, func(i, j int) bool { return combined[i].Track < combined[j].Track })
	seed.Availability, err = json.Marshal(map[string]any{"revision": b.Revision, "items": combined, "workloads": len(catalogs["workloads"])})
	if err != nil {
		return seed, err
	}
	if table {
		lanesJSON, _ := json.Marshal(lanes)
		mp := url.Values{}
		for k, v := range p {
			mp[k] = append([]string(nil), v...)
		}
		mp.Set("tracks", string(lanesJSON))
		mp.Set("metric", "time.wall")
		mp.Set("scenario", "steady")
		mp.Set("statistic", "median_ns_per_operation")
		mp.Set("profile", "timing")
		seed.Matrix, err = b.read(ctx, "matrix", mp)
	}
	return seed, err
}
