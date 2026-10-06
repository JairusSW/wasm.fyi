package wire

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestFeatureProbeCountAndAbsenceContracts(t *testing.T) {
	h := strings.Repeat("a", 64)
	probe := FeatureProbe{Schema: 1, Policy: FeatureProbePolicy, ReportID: h, EnvironmentID: h, ConfigurationID: h, TrackID: h, ContractID: h, Runtime: "engine", Workload: "features/simd/probe", Feature: "simd", Created: time.Date(2026, 10, 6, 0, 0, 0, 0, time.UTC), TrialCount: 1, Scenarios: []FeatureScenario{{PassID: "source-pass", Profile: "timing", Scenario: "steady", TrialCount: 1, Outcomes: map[string]int{"unsupported": 1}}}, Evidence: []string{h}}
	bytes, _ := Encode(probe)
	if _, err := FeatureProbeData(bytes); err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(map[string]any){
		"missing count":           func(v map[string]any) { delete(v, "trialCount") },
		"null count":              func(v map[string]any) { v["trialCount"] = nil },
		"population drift":        func(v map[string]any) { v["trialCount"] = 2 },
		"missing evidence":        func(v map[string]any) { v["evidence"] = []any{} },
		"foreign logical feature": func(v map[string]any) { v["feature"] = "threads" },
		"invented conformance":    func(v map[string]any) { v["conformancePassed"] = true },
		"duplicated pass": func(v map[string]any) {
			rows := v["scenarios"].([]any)
			v["scenarios"] = append(rows, rows[0])
			v["trialCount"] = 2
		},
	} {
		t.Run(name, func(t *testing.T) {
			var value map[string]any
			json.Unmarshal(bytes, &value)
			mutate(value)
			bad, _ := Encode(value)
			if _, err := FeatureProbeData(bad); err == nil {
				t.Fatal("invalid feature summary admitted")
			}
		})
	}
	probe.TrialCount = 0
	probe.Scenarios = []FeatureScenario{}
	probe.Evidence = []string{}
	empty, _ := Encode(probe)
	if _, err := FeatureProbeData(empty); err != nil {
		t.Fatal("unvisited probe manufactured evidence", err)
	}
}
