package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math"
	"math/big"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

// Inputs are existing immutable reports verified/exported by the installed
// producer. This opt-in gate performs no measurement or archived execution.
func TestRealProducerServingParity(t *testing.T) {
	raw := os.Getenv("WASMFYI_REAL_REPORTS")
	if raw == "" {
		t.Skip("set WASMFYI_REAL_REPORTS to JSON source/export pairs")
	}
	var inputs []struct{ Source, Export string }
	if e := json.Unmarshal([]byte(raw), &inputs); e != nil || len(inputs) == 0 {
		t.Fatal("invalid real report inputs", e)
	}
	s, e := store.Open(t.TempDir(), "real-source-parity")
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	timingExpected := map[string]map[string]json.RawMessage{}
	memoryExpected := map[string]map[string]json.RawMessage{}
	codeExpected := map[string]string{}
	analysisExpected := map[string]map[string]json.RawMessage{}
	reportSources := map[string]string{}
	for i, input := range inputs {
		b, e := os.ReadFile(filepath.Join(input.Source, "data.json"))
		if e != nil {
			t.Fatal(e)
		}
		sourceDataSHA := wire.Hash(b)
		var sourceFields map[string]json.RawMessage
		if e = json.Unmarshal(b, &sourceFields); e != nil {
			t.Fatal(e)
		}
		seal, e := os.ReadFile(filepath.Join(input.Source, "checksums.json"))
		if e != nil {
			t.Fatal(e)
		}
		var source struct {
			Summaries []map[string]json.RawMessage
			Memory    []map[string]json.RawMessage `json:"memory_stages"`
			Code      []map[string]json.RawMessage `json:"code_records"`
		}
		if e = json.Unmarshal(b, &source); e != nil {
			t.Fatal(e)
		}
		b, e = os.ReadFile(filepath.Join(input.Export, "manifest.json"))
		if e != nil {
			t.Fatal(e)
		}
		var manifest wire.Manifest
		if e = wire.Decode(b, &manifest); e != nil {
			t.Fatal(e)
		}
		if manifest.SourceReportSHA256 != sourceDataSHA || manifest.SourceSealSHA256 != wire.Hash(seal) || manifest.ExporterIdentity == nil || !wire.IsHash(manifest.ExporterIdentity.BinarySHA256) {
			t.Fatal("real source/exporter provenance drift")
		}
		analysisExpected[manifest.ReportID] = sourceFields
		for _, summary := range source.Summaries {
			var runtime, workload, scenario, profile string
			_ = json.Unmarshal(summary["runtime"], &runtime)
			_ = json.Unmarshal(summary["workload"], &workload)
			_ = json.Unmarshal(summary["scenario"], &scenario)
			_ = json.Unmarshal(summary["profile"], &profile)
			delete(summary, "launch_medians")
			delete(summary, "warmup_diagnostics")
			timingExpected[manifest.ReportID+"|"+runtime+"|"+workload+"|"+scenario+"|"+profile] = summary
		}
		job := wire.Job{Schema: 2, Session: "real-source-parity", Machine: "archived-evidence", Corpus: strings.Repeat("x", i+1), Attempt: "verified-export", Plan: wire.Hash([]byte("read-only source parity")), ConfiguredHarnessPin: "0509a0a323f41c58a2f2db15a372fb2e63c692bf", ParentBundleSHA256: wire.Hash([]byte("fixture association, not an archived tool bundle")), Status: "completed", Exports: []wire.Export{{SHA256: wire.Hash(b), Manifest: manifest}}}
		identity := func(m map[string]json.RawMessage, fields ...string) string {
			key := manifest.ReportID
			for _, field := range fields {
				var value string
				_ = json.Unmarshal(m[field], &value)
				key += "|" + value
			}
			return key
		}
		for _, summary := range source.Memory {
			delete(summary, "launch_values")
			delete(summary, "trial_ids")
			memoryExpected[identity(summary, "runtime", "workload", "scenario", "metric")] = summary
		}
		for _, record := range source.Code {
			value := record["size_bytes"]
			if len(value) == 0 || string(value) == "null" {
				continue
			}
			text := string(value)
			if value[0] == '"' {
				_ = json.Unmarshal(value, &text)
			}
			codeExpected[identity(record, "runtime", "workload", "trial")] = text
		}
		id, e := s.Submit(job)
		if e != nil {
			t.Fatal(e)
		}
		objects := append([]wire.Object{}, manifest.Objects...)
		for _, page := range manifest.InventoryPages {
			data, e := os.ReadFile(filepath.Join(input.Export, "objects", page.SHA256))
			if e != nil {
				t.Fatal(e)
			}
			if e = s.InstallDeclared(page.SHA256, bytes.NewReader(data)); e != nil {
				t.Fatal(e)
			}
			if e = s.AttachInventory(id, page.SHA256); e != nil {
				t.Fatal(e)
			}
			var inventory wire.InventoryPage
			if e = wire.Decode(data, &inventory); e != nil {
				t.Fatal(e)
			}
			objects = append(objects, inventory.Objects...)
		}
		for _, object := range objects {
			data, e := os.ReadFile(filepath.Join(input.Export, "objects", object.SHA256))
			if e != nil {
				t.Fatal(e)
			}
			if e = s.InstallDeclared(object.SHA256, bytes.NewReader(data)); e != nil {
				t.Fatal(e)
			}
		}
		if _, e = s.Commit(id); e != nil {
			t.Fatal("real producer import", e)
		}
		reportSources[manifest.ReportID] = input.Source
		t.Logf("imported verified export %s (%d objects)", filepath.Base(input.Export), len(objects))
	}
	revision := s.Current()
	rows, e := s.Results(store.Query{Revision: revision}, true)
	if e != nil {
		t.Fatal(e)
	}
	key, e := s.CursorKey()
	if e != nil {
		t.Fatal(e)
	}
	h, e := New(s, strings.Repeat("x", 32), key)
	if e != nil {
		t.Fatal(e)
	}
	files, e := s.Catalog(revision, "report-file")
	if e != nil {
		t.Fatal(e)
	}
	for _, record := range files {
		file, e := wire.ReportFileData(record.Data)
		if e != nil {
			t.Fatal(e)
		}
		original, e := os.ReadFile(filepath.Join(reportSources[file.ReportID], file.Name))
		if e != nil {
			t.Fatal(e)
		}
		var assembled []byte
		for _, chunk := range file.Chunks {
			response := request(t, h, "GET", "/api/v1/files/"+record.ID+"/chunks/"+chunk.SHA256+"?revision="+revision, nil, nil)
			if response.Code != 200 {
				t.Fatal("original file chunk unavailable", response.Code, response.Body.String())
			}
			assembled = append(assembled, response.Body.Bytes()...)
		}
		if !bytes.Equal(assembled, original) || wire.Hash(original) != file.SHA256 {
			t.Fatal("analytical file drift", file.Name)
		}
	}
	t.Logf("preserved %d original analytical files through HTTP", len(files))
	analysisFields := 0
	for reportID, source := range analysisExpected {
		record, e := s.Record(revision, "report", reportID)
		if e != nil {
			t.Fatal(e)
		}
		descriptor, e := wire.ReportEvidenceData(record.Data)
		if e != nil {
			t.Fatal(e)
		}
		if descriptor.AnalysisSectionVersion == "source-fields-v1" {
			for field := range source {
				switch field {
				case "bundle", "summaries", "memory_stages", "code_records", "metrics", "schema":
					continue
				}
				if strings.HasSuffix(field, "_version") {
					continue
				}
				if descriptor.AnalysisSections[field] == "" {
					t.Fatal("derived source field missing", field)
				}
			}
		}
		// Legacy exports remain valid. Fresh analytical exporters must retain all
		// declared source fields through selected evidence HTTP responses.
		for field, digest := range descriptor.AnalysisSections {
			fetch := func(id string) ([]byte, error) {
				w := request(t, h, "GET", "/api/v1/reports/"+reportID+"/evidence?revision="+revision+"&chunk="+id, nil, nil)
				if w.Code != 200 || w.Body.Len() > wire.ResponseBytes {
					return nil, fmt.Errorf("analysis HTTP status %d", w.Code)
				}
				return w.Body.Bytes(), nil
			}
			body, e := fetch(digest)
			if e != nil {
				t.Fatal(e)
			}
			resource, e := wire.Resource(body)
			if e != nil {
				t.Fatal(e)
			}
			if resource != nil {
				body, e = wire.AssembleResource(*resource, fetch)
				if e != nil {
					t.Fatal(e)
				}
			}
			var section wire.ReportAnalysis
			if e = wire.Decode(body, &section); e != nil {
				t.Fatal(e)
			}
			var expected, actual bytes.Buffer
			if json.Compact(&expected, source[field]) != nil || json.Compact(&actual, section.Data) != nil || !bytes.Equal(expected.Bytes(), actual.Bytes()) {
				t.Fatal("derived source analysis changed", field)
			}
			analysisFields++
		}
	}
	t.Logf("selected producer analysis sections retained: %d", analysisFields)
	matched, scopes := 0, map[string]store.CohortScope{}
	memoryMatched, codeMatched := 0, 0
	for _, record := range rows {
		var r wire.Result
		if e = wire.Decode(record.Data, &r); e != nil {
			t.Fatal(e)
		}
		if r.Metric != "time.wall" {
			if r.Statistic == "median_bytes" {
				want := memoryExpected[r.ReportID+"|"+r.Runtime+"|"+r.Workload+"|"+r.Scenario+"|"+r.Metric]
				var got map[string]json.RawMessage
				_ = json.Unmarshal(r.Summary, &got)
				a, _ := wire.Encode(want)
				b, _ := wire.Encode(got)
				if want == nil || !bytes.Equal(a, b) {
					t.Fatal("memory source summary drift", r.Workload, r.Metric)
				}
				memoryMatched++
			}
			if r.Metric == "native.code_size" {
				var summary struct {
					Size     json.RawMessage `json:"size_bytes"`
					Trial    string          `json:"trial_id"`
					Artifact string          `json:"artifactId"`
				}
				_ = json.Unmarshal(r.Summary, &summary)
				want := codeExpected[r.ReportID+"|"+r.Runtime+"|"+r.Workload+"|"+summary.Trial]
				text := string(summary.Size)
				if len(summary.Size) > 0 && summary.Size[0] == '"' {
					_ = json.Unmarshal(summary.Size, &text)
				}
				a, okA := new(big.Int).SetString(want, 10)
				b, okB := new(big.Int).SetString(text, 10)
				if !okA || !okB || a.Cmp(b) != 0 {
					t.Fatal("measured native size drift", r.Workload)
				}
				codeMatched++
				artifact, e := s.Record(revision, "artifact", summary.Artifact)
				if e != nil {
					t.Fatal(e)
				}
				descriptor, e := wire.ArtifactData(artifact.Data)
				if e != nil {
					t.Fatal(e)
				}
				if descriptor.Content.Status == "unavailable" {
					if descriptor.Content.SHA256 != "" {
						t.Fatal("unavailable native bytes have a hash")
					}
					if _, _, e = s.ArtifactBytes(context.Background(), revision, summary.Artifact); e == nil {
						t.Fatal("unavailable native content downloadable")
					}
				}
			}
			continue
		}
		want := timingExpected[r.ReportID+"|"+r.Runtime+"|"+r.Workload+"|"+r.Scenario+"|"+r.Profile]
		if want == nil {
			t.Fatal("timing result not in source")
		}
		var got map[string]json.RawMessage
		_ = json.Unmarshal(r.Summary, &got)
		a, _ := wire.Encode(want)
		b, _ := wire.Encode(got)
		if !bytes.Equal(a, b) {
			t.Fatal("scientific summary drift", r.ReportID, r.Workload)
		}
		matched++
		if r.MeasurementMethod == nil || r.MeasurementMethod.Status != "available" {
			t.Fatal("real source method unavailable")
		}
		id := r.EnvironmentID + "|" + r.TrackID + "|" + r.MeasurementMethodID
		scopes[id] = store.CohortScope{Revision: revision, Environment: r.EnvironmentID, Lanes: []string{r.TrackID}, LaneKind: "track", Baseline: r.TrackID, Selectors: []store.CohortSelector{{Definition: r.MetricDefinitionID, Method: r.MeasurementMethodID, Analysis: r.AnalysisVersion}}, Policy: "shared-geometric-v1", Weighting: "workload", Workloads: "all", MixedConfigurations: "explicit-membership", Collectors: "allow-unrecorded-timing", Definitions: "require-registered", Contracts: "latest-in-scope"}
	}
	if matched != len(timingExpected) {
		t.Fatal("source summaries disappeared", matched, len(timingExpected))
	}
	if memoryMatched != len(memoryExpected) || codeMatched != len(codeExpected) {
		t.Fatal("memory/code source results disappeared", memoryMatched, len(memoryExpected), codeMatched, len(codeExpected))
	}
	for _, scope := range scopes {
		c, e := s.ComputeCohort(context.Background(), scope)
		if e != nil {
			t.Fatal("real cohort incompatible", e)
		}
		if len(c.Comparison.Populations) != 1 {
			t.Fatal("unexpected scope population")
		}
		p := c.Comparison.Populations[0]
		if p.Count == 0 {
			continue
		}
		logSum := 0.0
		for _, m := range p.Members {
			var r wire.Result
			record, e := s.Record(revision, "result", m.Cell.Result)
			if e != nil {
				t.Fatal(e)
			}
			_ = wire.Decode(record.Data, &r)
			var summary struct {
				Value float64 `json:"median_ns_per_operation"`
			}
			_ = json.Unmarshal(r.Summary, &summary)
			logSum += math.Log(summary.Value)
		}
		want := math.Exp(logSum / float64(p.Count))
		if math.Abs(*p.Value-want) > want*1e-12 || *p.Ratio != 1 {
			t.Fatal("source-derived point estimate drift")
		}
		b, _ := wire.Encode(scope)
		w := request(t, h, "GET", "/api/v1/aggregates?scope="+url.QueryEscape(string(b)), nil, nil)
		if w.Code != 200 || w.Body.Len() > wire.ResponseBytes {
			t.Fatal("real HTTP summary failed", w.Code, w.Body.String())
		}
		var response struct {
			Cohort, Digest string
			Comparison     struct {
				Populations []struct {
					Count        int
					Value, Ratio *float64
				}
			}
		}
		if e = json.Unmarshal(w.Body.Bytes(), &response); e != nil || response.Digest != c.Digest || len(response.Comparison.Populations) != 1 || response.Comparison.Populations[0].Count != p.Count || response.Comparison.Populations[0].Value == nil || *response.Comparison.Populations[0].Value != *p.Value || response.Comparison.Populations[0].Ratio == nil || *response.Comparison.Populations[0].Ratio != 1 {
			t.Fatal("HTTP aggregate/source parity drift", e)
		}
		w = request(t, h, "GET", "/api/v1/overview?scope="+url.QueryEscape(string(b)), nil, nil)
		var overview overviewResponse
		if w.Code != 200 || w.Body.Len() > 50*1024 || json.Unmarshal(w.Body.Bytes(), &overview) != nil || overview.Digest != c.Digest || len(overview.Cards) != 1 || overview.Cards[0].Count != p.Count || overview.Cards[0].Value == nil || *overview.Cards[0].Value != *p.Value || overview.Cards[0].Ratio == nil || *overview.Cards[0].Ratio != 1 {
			t.Fatal("HTTP overview/source parity drift", w.Code, w.Body.String())
		}
		w = request(t, h, "GET", "/api/v1/cohorts/"+response.Cohort+"?limit=1", nil, nil)
		if w.Code != 200 {
			t.Fatal("real membership failed", w.Code, w.Body.String())
		}
	}
	t.Logf("verified-source summaries retained: timing=%d memory=%d native-size=%d; exact environment/track/method scopes=%d", matched, memoryMatched, codeMatched, len(scopes))
}
