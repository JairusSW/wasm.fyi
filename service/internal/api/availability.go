package api

import (
	"encoding/json"
	"net/http"
	"sort"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

type availableLane struct {
	Track          string            `json:"track"`
	Configurations []wire.Record     `json:"configurations"`
	Metrics        []availableMetric `json:"metrics"`
	Coverage       [5]int            `json:"coverage"`
}
type availableMetric struct {
	Metric    string                 `json:"metric"`
	Scenario  string                 `json:"scenario"`
	Profile   string                 `json:"profile"`
	Statistic string                 `json:"statistic"`
	Selectors []store.CohortSelector `json:"selectors"`
	Results   int                    `json:"results"`
}

// Scope discovery reads current summaries, never historical reports or trials.
// It returns small method/configuration references for complete-scope queries.
func (a *API) availability(w http.ResponseWriter, r *http.Request, revision string, immutable bool) {
	p := r.URL.Query()
	if p.Has("version") && p.Get("version") != "availability-v3" {
		problem(w, r, wire.Invalid("unsupported availability version"))
		return
	}
	immutable = immutable && p.Get("version") == "availability-v3"
	reader := a.Store.ReadQueryView()
	q := store.Query{Revision: revision, Environment: p.Get("environment"), Selection: p.Get("selection"), Metric: p.Get("metric"), Scenario: p.Get("scenario"), Profile: p.Get("profile"), Statistic: p.Get("statistic"), Sort: "catalog"}
	if !wire.IsHash(q.Environment) {
		problem(w, r, wire.Invalid("availability requires a recorded environment"))
		return
	}
	if q.Selection == "" || q.Selection == "s1" {
		q.Selection = "current"
	}
	if q.Selection == "s2" {
		q.Selection = "previous"
	}
	if q.Selection != "current" && q.Selection != "previous" {
		problem(w, r, wire.Invalid("invalid availability selection"))
		return
	}
	if p.Has("environments") {
		if err := wire.Decode([]byte(p.Get("environments")), &q.Environments); err != nil || len(q.Environments) == 0 {
			problem(w, r, wire.Invalid("invalid availability membership"))
			return
		}
	}
	var err error
	q.Environments, err = reader.NormalizeHostEnvironments(revision, q.Environment, q.Environments)
	if err != nil {
		problem(w, r, err)
		return
	}
	rows, err := a.resultRows(r.Context(), q, false)
	if err != nil {
		problem(w, r, err)
		return
	}
	lanes := map[string]*availableLane{}
	configs := map[string]map[string]bool{}
	metrics := map[string]map[string]*availableMetric{}
	selectors := map[string]map[store.CohortSelector]bool{}
	comparableRSS := map[store.CohortSelector]bool{}
	checkedRSS := map[store.CohortSelector]bool{}
	workloads := map[string]bool{}
	coverage := map[string]map[string]struct {
		created time.Time
		id      string
		bucket  int
	}{}
	for _, record := range rows {
		var value wire.Result
		if err = wire.Decode(record.Data, &value); err != nil {
			problem(w, r, err)
			return
		}
		if value.Workload == "mechanisms/wasm-to-host-call" {
			continue
		}
		workloads[value.Workload] = true
		lane := lanes[value.TrackID]
		if lane == nil {
			lane = &availableLane{Track: value.TrackID, Configurations: []wire.Record{}, Metrics: []availableMetric{}}
			lanes[value.TrackID] = lane
			configs[value.TrackID] = map[string]bool{}
			metrics[value.TrackID] = map[string]*availableMetric{}
		}
		configs[value.TrackID][value.ConfigurationID] = true
		key := value.Metric + ":" + value.Scenario + ":" + value.Profile + ":" + value.Statistic
		metric := metrics[value.TrackID][key]
		if metric == nil {
			metric = &availableMetric{Metric: value.Metric, Scenario: value.Scenario, Profile: value.Profile, Statistic: value.Statistic, Selectors: []store.CohortSelector{}}
			metrics[value.TrackID][key] = metric
			selectors[value.TrackID+":"+key] = map[store.CohortSelector]bool{}
		}
		metric.Results++
		if value.MeasurementMethodID != "" {
			selector := store.CohortSelector{Definition: value.MetricDefinitionID, Method: value.MeasurementMethodID, Analysis: value.AnalysisVersion}
			set := selectors[value.TrackID+":"+key]
			comparable := true
			if value.Metric == "process.rss" || value.Metric == "process.peak_rss" {
				if !checkedRSS[selector] {
					method, e := reader.MethodContext(r.Context(), revision, selector.Definition, selector.Method)
					if e != nil {
						problem(w, r, e)
						return
					}
					checkedRSS[selector] = true
					comparableRSS[selector] = method.Status == "available" && method.CollectorStatus == "recorded"
				}
				comparable = comparableRSS[selector]
			}
			if comparable && !set[selector] {
				set[selector] = true
				metric.Selectors = append(metric.Selectors, selector)
			}
		}
		if value.Metric == "time.wall" && value.Scenario == "steady" && value.Profile == "timing" {
			var summary struct {
				Outcomes map[string]int
				Median   *float64 `json:"median_ns_per_operation"`
			}
			_ = json.Unmarshal(value.Summary, &summary)
			bucket := 4
			switch {
			case summary.Outcomes["failed"] > 0:
				bucket = 1
			case summary.Outcomes["crashed"] > 0 || summary.Outcomes["timeout"] > 0:
				bucket = 2
			case summary.Outcomes["ok"] > 0 && summary.Median != nil:
				bucket = 0
			case summary.Outcomes["unsupported"] > 0:
				bucket = 3
			}
			if coverage[value.TrackID] == nil {
				coverage[value.TrackID] = map[string]struct {
					created time.Time
					id      string
					bucket  int
				}{}
			}
			old, ok := coverage[value.TrackID][value.Workload]
			if !ok || value.Created.After(old.created) || value.Created.Equal(old.created) && record.ID > old.id {
				coverage[value.TrackID][value.Workload] = struct {
					created time.Time
					id      string
					bucket  int
				}{value.Created, record.ID, bucket}
			}
		}
	}
	output := []availableLane{}
	for id, lane := range lanes {
		for _, cell := range coverage[id] {
			lane.Coverage[cell.bucket]++
		}
		if len(configs[id]) > 64 {
			problem(w, r, store.ErrLimit)
			return
		}
		for config := range configs[id] {
			record, err := reader.Record(revision, "configuration", config)
			if err != nil {
				problem(w, r, err)
				return
			}
			record, err = configurationSummary(record)
			if err != nil {
				problem(w, r, err)
				return
			}
			lane.Configurations = append(lane.Configurations, record)
		}
		sort.Slice(lane.Configurations, func(i, j int) bool { return lane.Configurations[i].ID < lane.Configurations[j].ID })
		keys := []string{}
		for key := range metrics[id] {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			metric := metrics[id][key]
			if len(metric.Selectors) > 32 {
				problem(w, r, store.ErrLimit)
				return
			}
			sort.Slice(metric.Selectors, func(i, j int) bool {
				x, _ := wire.Encode(metric.Selectors[i])
				y, _ := wire.Encode(metric.Selectors[j])
				return string(x) < string(y)
			})
			lane.Metrics = append(lane.Metrics, *metric)
		}
		output = append(output, *lane)
	}
	sort.Slice(output, func(i, j int) bool { return output[i].Track < output[j].Track })
	policy := "exact-environment-v1"
	if len(q.Environments) > 0 {
		policy = store.HostSelectionVersion
	}
	respond(w, r, 200, map[string]any{"revision": revision, "scope": q, "selectionPolicy": policy, "items": output, "workloads": len(workloads)}, immutable)
}
