package wire_test

import (
	"encoding/json"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"testing"
)

func TestConformanceLaneAvailabilityAndProjectedMetadata(t *testing.T) {
	_, objects, err := testutil.ConformanceFixture("wire")
	if err != nil {
		t.Fatal(err)
	}
	var data []byte
	for _, body := range objects {
		var record wire.Record
		if json.Unmarshal(body, &record) == nil && record.Kind == "conformance" {
			data = record.Data
		}
	}
	if _, err = wire.ConformanceLaneData(data); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"unit", "status", "totals", "engine", "suite", "reason", "parserVersion"} {
		var value map[string]any
		json.Unmarshal(data, &value)
		delete(value, field)
		body, _ := json.Marshal(value)
		if _, err = wire.ConformanceLaneData(body); err == nil {
			t.Fatalf("missing %s accepted", field)
		}
	}
	for name, change := range map[string]func(map[string]any){
		"unknown status":        func(v map[string]any) { v["status"] = "qualified" },
		"manufactured count":    func(v map[string]any) { v["totals"] = map[string]any{"passed": -1} },
		"fractional count":      func(v map[string]any) { v["totals"] = map[string]any{"passed": 1.5} },
		"unprojected host path": func(v map[string]any) { v["engine"] = map[string]any{"path": "/private/engine"} },
		"empty engine":          func(v map[string]any) { v["engine"] = map[string]any{} },
		"array engine":          func(v map[string]any) { v["engine"] = []any{} },
		"unknown policy":        func(v map[string]any) { v["policy"] = "benchmark-policy" },
		"false verification":    func(v map[string]any) { v["interpretationSource"] = "source-recomputed" },
	} {
		t.Run(name, func(t *testing.T) {
			var v map[string]any
			json.Unmarshal(data, &v)
			change(v)
			body, _ := json.Marshal(v)
			if _, err := wire.ConformanceLaneData(body); err == nil {
				t.Fatal("invalid descriptor accepted")
			}
		})
	}
}

func TestConformanceJobCannotClaimMeasurementToolsOrVerification(t *testing.T) {
	job, _, err := testutil.ConformanceFixture("job")
	if err != nil {
		t.Fatal(err)
	}
	if err = job.Validate(); err != nil {
		t.Fatal(err)
	}
	for name, change := range map[string]func(*wire.Job){
		"harness pin":  func(j *wire.Job) { j.ConfiguredHarnessPin = "a017c56" },
		"parent tools": func(j *wire.Job) { j.ParentBundleSHA256 = wire.Hash([]byte("tools")) },
		"wrong schema": func(j *wire.Job) { j.Schema = 2 },
		"measured export": func(j *wire.Job) {
			j.Exports[0].Manifest.Format = "site-v2"
			body, _ := wire.Encode(j.Exports[0].Manifest)
			j.Exports[0].SHA256 = wire.Hash(body)
		},
		"recomputed claim": func(j *wire.Job) {
			j.Exports[0].Manifest.Verification = "source-recomputed"
			body, _ := wire.Encode(j.Exports[0].Manifest)
			j.Exports[0].SHA256 = wire.Hash(body)
		},
	} {
		t.Run(name, func(t *testing.T) {
			body, _ := wire.Encode(job)
			var changed wire.Job
			wire.Decode(body, &changed)
			change(&changed)
			if err := changed.Validate(); err == nil {
				t.Fatal("invalid job accepted")
			}
		})
	}
}

func TestConformanceCoverageIsSeparateFromSuiteOutcomes(t *testing.T) {
	_, objects, err := testutil.ConformanceFixture("coverage")
	if err != nil {
		t.Fatal(err)
	}
	var contextData, coverageData []byte
	for _, body := range objects {
		var record wire.Record
		if json.Unmarshal(body, &record) != nil {
			continue
		}
		if record.Kind == "conformance-context" {
			contextData = record.Data
		}
		if record.Kind == "conformance-coverage" {
			coverageData = record.Data
		}
	}
	if _, err = wire.ConformanceContextData(contextData); err != nil {
		t.Fatal(err)
	}
	for _, count := range []any{nil, 0, 128} {
		var v map[string]any
		json.Unmarshal(contextData, &v)
		v["coverageCount"] = count
		body, _ := json.Marshal(v)
		if _, err = wire.ConformanceContextData(body); err != nil {
			t.Fatal("valid coverage availability rejected", count, err)
		}
	}
	for _, count := range []any{-1, 129, 1.5} {
		var v map[string]any
		json.Unmarshal(contextData, &v)
		v["coverageCount"] = count
		body, _ := json.Marshal(v)
		if _, err = wire.ConformanceContextData(body); err == nil {
			t.Fatal("invalid coverage count accepted", count)
		}
	}
	var v map[string]any
	json.Unmarshal(contextData, &v)
	delete(v, "coverageCount")
	body, _ := json.Marshal(v)
	if _, err = wire.ConformanceContextData(body); err == nil {
		t.Fatal("missing coverage availability accepted")
	}
	if _, err = wire.ConformanceCoverageData(coverageData); err != nil {
		t.Fatal(err)
	}
	for _, status := range []string{"passed", "failed", "unsupported"} {
		v = nil
		json.Unmarshal(coverageData, &v)
		v["status"] = status
		body, _ = json.Marshal(v)
		if _, err = wire.ConformanceCoverageData(body); err == nil {
			t.Fatal("suite outcome became collection coverage", status)
		}
	}
	v = nil
	json.Unmarshal(coverageData, &v)
	delete(v, "reason")
	body, _ = json.Marshal(v)
	if _, err = wire.ConformanceCoverageData(body); err == nil {
		t.Fatal("missing reason availability accepted")
	}
}
