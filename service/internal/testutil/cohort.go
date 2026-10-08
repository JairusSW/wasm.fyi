package testutil

import (
	"encoding/json"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

type CohortCell struct {
	Runtime, Version, Workload, ContractRevision, Group string
	Metric, Scenario, SourceProfile, ExactValue         string
	Value                                               float64
	Failed                                              bool
	MethodUnavailable                                   bool
}

// CohortFixture constructs synthetic transport records, never benchmark proof.
func CohortFixture(seed string, date time.Time, cells []CohortCell) (wire.Job, map[string][]byte, error) {
	job, old, e := Fixture(seed, date)
	if e != nil {
		return job, nil, e
	}
	manifest := &job.Exports[0].Manifest
	manifest.Objects = nil
	out := map[string][]byte{}
	environment, definition := "", ""
	add := func(kind, id string, data any) string {
		b, _ := wire.Encode(data)
		if id == "" {
			id = wire.Hash(b)
		}
		record, _ := wire.Encode(wire.Record{Kind: kind, ID: id, Data: b})
		digest := wire.Hash(record)
		if out[digest] == nil {
			out[digest] = record
			manifest.Objects = append(manifest.Objects, wire.Object{SHA256: digest, Bytes: len(record), Kind: "record"})
		}
		return id
	}
	for _, b := range old {
		var r wire.Record
		if json.Unmarshal(b, &r) != nil {
			continue
		}
		switch r.Kind {
		case "environment":
			environment = add(r.Kind, r.ID, json.RawMessage(r.Data))
		case "metric":
			var m struct{ Name string }
			_ = json.Unmarshal(r.Data, &m)
			if m.Name == "time.wall" {
				definition = add(r.Kind, r.ID, json.RawMessage(r.Data))
			}
		case "report":
			var data map[string]json.RawMessage
			_ = json.Unmarshal(r.Data, &data)
			data["headlineLatencyPolicy"], _ = wire.Encode(map[string]string{"status": "timing_pass"})
			add(r.Kind, r.ID, data)
		}
	}
	for _, cell := range cells {
		metric, scenario, profile, statistic, metricDefinition := cell.Metric, cell.Scenario, "timing", "median_ns_per_operation", definition
		if metric == "" {
			metric = "time.wall"
		}
		if scenario == "" {
			scenario = "steady"
		}
		definitionStatus := "available"
		if metric == "process.rss" {
			profile = "memory"
			statistic = "median_bytes"
			metricDefinition = add("metric", "", map[string]any{"name": metric, "version": 1, "unit": "bytes", "scope": "adapter_process", "boundary": "synthetic boundary fixture"})
		}
		if metric == "native.code_size" {
			profile = "code"
			scenario = "compile"
			statistic = "size_bytes"
			definitionStatus = "unregistered"
			metricDefinition = add("metric", "", map[string]string{"name": metric, "status": "unregistered", "reason": "synthetic size record fixture"})
		}
		if cell.SourceProfile != "" {
			profile = cell.SourceProfile
		}
		configuration := add("configuration", "", map[string]any{"id": cell.Runtime, "description": map[string]string{"runtime": cell.Runtime, "runtime_version": cell.Version, "backend": "fixture"}})
		track := add("track", "", map[string]string{"runtime": cell.Runtime, "sourceRuntimeId": cell.Runtime, "backend": "fixture"})
		contract := add("workload", "", map[string]any{"id": cell.Workload, "sha256": wire.Hash([]byte(cell.Workload + cell.ContractRevision)), "provenance": map[string]string{"category": cell.Group}, "revision": cell.ContractRevision})
		recipe, _ := wire.Encode(map[string]any{"protocol": 1, "options": map[string]any{"profile": profile, "scenarios": []string{scenario}, "launches": 1, "samples": 1}})
		method := &wire.MeasurementMethod{Schema: 1, Status: "available", Metric: metric, Scenario: scenario, Profile: profile, Statistic: statistic, Recipe: recipe, RecipeSHA256: wire.Hash(recipe), CollectorStatus: "not_recorded", Observations: []wire.ObservationIdentity{}}
		if metric == "process.rss" {
			method.CollectorStatus = "recorded"
			method.Observations = []wire.ObservationIdentity{{DefinitionVersion: 1, Unit: "bytes", Scope: "adapter_process", Phase: scenario + "/after_batch", Collector: "procfs", CollectorVersion: "1", Quality: "boundary_snapshot_only", Profile: profile, Denominator: "process"}}
		}
		if cell.MethodUnavailable {
			method.Status = "unavailable"
			method.Reason = "Retained source recipe unavailable"
			method.Recipe = nil
			method.RecipeSHA256 = ""
			method.CollectorStatus = "not_recorded"
			method.Observations = []wire.ObservationIdentity{}
		}
		outcomes := map[string]int{"ok": 1}
		if cell.Failed {
			outcomes["timeout"] = 1
		}
		var rawValue any = cell.Value
		if cell.ExactValue != "" {
			rawValue = cell.ExactValue
		}
		summary, _ := wire.Encode(map[string]any{statistic: rawValue, "status": "available", "outcomes": outcomes, "latency_status": "timing_pass", "sample_count": 1, "independent_launches": 1})
		result := wire.Result{ReportID: manifest.ReportID, EnvironmentID: environment, ConfigurationID: configuration, TrackID: track, ContractID: contract, Workload: cell.Workload, Runtime: cell.Runtime, MetricDefinitionID: metricDefinition, MetricDefinitionStatus: definitionStatus, Metric: metric, Scenario: scenario, Profile: profile, Statistic: statistic, Created: date, AnalysisVersion: "cluster-median-bootstrap-v6", Summary: summary, Evidence: []string{}, MeasurementMethod: method, MeasurementMethodID: method.ID()}
		add("result", "", result)
	}
	b, _ := wire.Encode(manifest)
	job.Exports[0].SHA256 = wire.Hash(b)
	return job, out, nil
}
