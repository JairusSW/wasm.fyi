package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

// Source code records distinguish engine-reported size from materialized image
// extent. Preserve producer precedence, availability and exact integer text.
func realCodeMeasurement(record map[string]json.RawMessage) (string, string, bool, error) {
	for _, field := range []struct{ name, metric string }{{"size_bytes", "native.code_size"}, {"image_bytes", "native.code_image"}} {
		value := bytes.TrimSpace(record[field.name])
		if len(value) == 0 || bytes.Equal(value, []byte("null")) {
			continue
		}
		text := string(value)
		if value[0] == '"' {
			if err := json.Unmarshal(value, &text); err != nil {
				return "", "", false, err
			}
		}
		if text == "" {
			return "", "", false, fmt.Errorf("empty source code-size value")
		}
		for _, digit := range text {
			if digit < '0' || digit > '9' {
				return "", "", false, fmt.Errorf("non-integer source code-size value")
			}
		}
		return field.metric, text, true, nil
	}
	return "", "", false, nil
}

func TestRealCodeExportParity(t *testing.T) {
	text := os.Getenv("WASMFYI_REAL_REPORTS")
	if text == "" {
		t.Skip("set WASMFYI_REAL_REPORTS to verified source/export pairs")
	}
	var inputs []struct{ Source, Export, Disassembly string }
	if err := json.Unmarshal([]byte(text), &inputs); err != nil || len(inputs) == 0 {
		t.Fatal("invalid real fixture inputs", err)
	}
	for _, input := range inputs {
		data, err := os.ReadFile(filepath.Join(input.Source, "data.json"))
		if err != nil {
			t.Fatal(err)
		}
		var source struct {
			Code []map[string]json.RawMessage `json:"code_records"`
		}
		if err := json.Unmarshal(data, &source); err != nil {
			t.Fatal(err)
		}
		manifestBytes, err := os.ReadFile(filepath.Join(input.Export, "manifest.json"))
		if err != nil {
			t.Fatal(err)
		}
		var manifest wire.Manifest
		if err := wire.Decode(manifestBytes, &manifest); err != nil || manifest.SourceReportSHA256 != wire.Hash(data) {
			t.Fatal("source/export provenance mismatch", err)
		}
		seal, err := os.ReadFile(filepath.Join(input.Source, "checksums.json"))
		if err != nil || manifest.SourceSealSHA256 != wire.Hash(seal) {
			t.Fatal("source/export seal mismatch", err)
		}
		key := func(runtime, workload, trial, metric string) string {
			return runtime + "|" + workload + "|" + trial + "|" + metric
		}
		want := map[string]string{}
		for _, record := range source.Code {
			metric, value, available, err := realCodeMeasurement(record)
			if err != nil {
				t.Fatal(err)
			}
			if !available {
				continue
			}
			var runtime, workload, trial string
			for field, target := range map[string]*string{"runtime": &runtime, "workload": &workload, "trial": &trial} {
				if err := json.Unmarshal(record[field], target); err != nil || *target == "" {
					t.Fatal("invalid source code identity", field, err)
				}
			}
			id := key(runtime, workload, trial, metric)
			if _, exists := want[id]; exists {
				t.Fatal("duplicate source code identity", id)
			}
			want[id] = value
		}
		objects := append([]wire.Object{}, manifest.Objects...)
		for _, page := range manifest.InventoryPages {
			body, err := os.ReadFile(filepath.Join(input.Export, "objects", page.SHA256))
			if err != nil {
				t.Fatal(err)
			}
			entries, err := page.Decode(body)
			if err != nil {
				t.Fatal(err)
			}
			objects = append(objects, entries...)
		}
		seen := map[string]bool{}
		counts := map[string]int{}
		for _, object := range objects {
			if object.Kind != "record" {
				continue
			}
			body, err := os.ReadFile(filepath.Join(input.Export, "objects", object.SHA256))
			if err != nil || len(body) != object.Bytes || wire.Hash(body) != object.SHA256 {
				t.Fatal("export record integrity mismatch", err)
			}
			var record wire.Record
			if err := wire.Decode(body, &record); err != nil {
				t.Fatal(err)
			}
			if record.Kind != "result" {
				continue
			}
			var result wire.Result
			if err := wire.Decode(record.Data, &result); err != nil {
				t.Fatal(err)
			}
			if result.Metric != "native.code_size" && result.Metric != "native.code_image" {
				continue
			}
			var summary struct {
				Size  json.RawMessage `json:"size_bytes"`
				Trial string          `json:"trial_id"`
			}
			if err := json.Unmarshal(result.Summary, &summary); err != nil {
				t.Fatal(err)
			}
			_, value, available, err := realCodeMeasurement(map[string]json.RawMessage{"size_bytes": summary.Size})
			id := key(result.Runtime, result.Workload, summary.Trial, result.Metric)
			if err != nil || !available || seen[id] || result.ReportID != manifest.ReportID || want[id] != value {
				t.Fatal("real exported native size drift", id, err)
			}
			seen[id] = true
			counts[result.Metric]++
		}
		if len(seen) != len(want) {
			t.Fatal("native size source population disappeared", len(seen), len(want))
		}
		t.Logf("real native code export parity: %v", counts)
	}
}

func TestRealCodeOraclePreservesReportedSizeImageExtentAndZero(t *testing.T) {
	for _, test := range []struct{ source, metric, value string }{
		{`{"size_bytes":123,"image_bytes":456}`, "native.code_size", "123"},
		{`{"size_bytes":null,"image_bytes":456}`, "native.code_image", "456"},
		{`{"image_bytes":0}`, "native.code_image", "0"},
		{`{"size_bytes":0,"image_bytes":456}`, "native.code_size", "0"},
		{`{"size_bytes":"9007199254740993"}`, "native.code_size", "9007199254740993"},
		{`{"size_bytes":null,"image_bytes":null}`, "", ""},
	} {
		var record map[string]json.RawMessage
		if err := json.Unmarshal([]byte(test.source), &record); err != nil {
			t.Fatal(err)
		}
		metric, value, available, err := realCodeMeasurement(record)
		if err != nil || metric != test.metric || value != test.value || available != (test.metric != "") {
			t.Fatal("source code measurement changed", test, metric, value, available, err)
		}
	}
	for _, source := range []string{`{"size_bytes":-1}`, `{"image_bytes":1.5}`, `{"size_bytes":""}`, `{"size_bytes":true}`} {
		var record map[string]json.RawMessage
		_ = json.Unmarshal([]byte(source), &record)
		if _, _, _, err := realCodeMeasurement(record); err == nil {
			t.Fatal("invalid source size silently accepted", source)
		}
	}
}
