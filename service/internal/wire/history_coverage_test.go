package wire_test

import (
	"encoding/json"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"testing"
)

func TestHistoryCoverageAvailabilityAndIdentity(t *testing.T) {
	job, err := testutil.HistoryCoverageFixture("metadata", "darwin/arm64")
	if err != nil {
		t.Fatal(err)
	}
	if err = job.Validate(); err != nil {
		t.Fatal(err)
	}
	original := job.HistoryCoverage[0]
	for name, mutate := range map[string]func(map[string]any){
		"invented measurement":       func(v map[string]any) { v["sourceReportSha256"] = wire.Hash([]byte("source")) },
		"false publication":          func(v map[string]any) { v["publishedRevision"] = wire.Hash([]byte("revision")) },
		"logical identity":           func(v map[string]any) { v["coverageId"] = wire.Hash([]byte("different")) },
		"implicit status":            func(v map[string]any) { v["status"] = "unsupported" },
		"missing availability":       func(v map[string]any) { delete(v, "reason") },
		"collector mismatch":         func(v map[string]any) { v["recordedStatus"] = "collected" },
		"missing build availability": func(v map[string]any) { delete(v["desiredBuild"].(map[string]any), "revision") },
		"unrequested number":         func(v map[string]any) { v["summary"] = map[string]any{"value": 0} },
	} {
		t.Run(name, func(t *testing.T) {
			var data map[string]any
			json.Unmarshal(original, &data)
			mutate(data)
			body, _ := wire.Encode(data)
			if _, err := wire.HistoryCoverageData(body); err == nil {
				t.Fatal("invalid coverage accepted")
			}
		})
	}
	for name, mutate := range map[string]func(*wire.Job){
		"measured job":    func(j *wire.Job) { j.Schema = 2; j.Kind = "" },
		"scope":           func(j *wire.Job) { j.Plan = wire.Hash([]byte("wrong scope")) },
		"duplicate cell":  func(j *wire.Job) { j.HistoryCoverage = append(j.HistoryCoverage, j.HistoryCoverage[0]) },
		"pretend tools":   func(j *wire.Job) { j.ParentBundleSHA256 = wire.Hash([]byte("tools")) },
		"pretend harness": func(j *wire.Job) { j.ConfiguredHarnessPin = "a017c56" },
		"no metadata":     func(j *wire.Job) { j.HistoryCoverage = nil },
	} {
		t.Run(name, func(t *testing.T) {
			encoded, _ := wire.Encode(job)
			var changed wire.Job
			wire.Decode(encoded, &changed)
			mutate(&changed)
			if err := changed.Validate(); err == nil {
				t.Fatal("invalid metadata publication accepted")
			}
		})
	}
}
