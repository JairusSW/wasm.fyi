package api

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"math/big"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
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
	var inputs []struct{ Source, Export, Disassembly string }
	if e := json.Unmarshal([]byte(raw), &inputs); e != nil || len(inputs) == 0 {
		t.Fatal("invalid real report inputs", e)
	}
	limits := store.DefaultLimits()
	if text := os.Getenv("WASMFYI_REAL_PENDING_BYTES"); text != "" {
		value, err := strconv.ParseInt(text, 10, 64)
		if err != nil || value < limits.PendingBytes || value > 8<<30 {
			t.Fatal("invalid explicit real-fixture pending quota", err)
		}
		limits.PendingBytes = value
		t.Logf("explicit real-fixture pending quota: %d bytes", value)
	}
	root := t.TempDir()
	if path := os.Getenv("WASMFYI_REAL_STORE"); path != "" {
		if err := os.Mkdir(path, 0700); err != nil {
			t.Fatal("real-fixture retained store must be new", err)
		}
		root = path
		t.Logf("retained real-fixture store: %s", root)
	}
	resume := os.Getenv("WASMFYI_REAL_RESUME_STORE")
	if resume != "" {
		if os.Getenv("WASMFYI_REAL_STORE") != "" {
			t.Fatal("new and resumed stores are mutually exclusive")
		}
		info, err := os.Lstat(resume)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			t.Fatal("resume requires an existing real directory", err)
		}
		root = resume
		t.Logf("resuming retained real-fixture store: %s", root)
	}
	s, e := store.OpenWithLimits(root, "real-source-parity", limits)
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
			metric, text, available, err := realCodeMeasurement(record)
			if err != nil {
				t.Fatal(err)
			}
			if !available {
				continue
			}
			codeExpected[identity(record, "runtime", "workload", "trial")+"|"+metric] = text
		}
		id, e := s.Submit(job)
		if e != nil {
			t.Fatal(e)
		}
		status, e := s.ImportStatus(id)
		if e != nil {
			t.Fatal(e)
		}
		published := status.State == "published"
		objects := append([]wire.Object{}, manifest.Objects...)
		for _, page := range manifest.InventoryPages {
			data, e := os.ReadFile(filepath.Join(input.Export, "objects", page.SHA256))
			if e != nil {
				t.Fatal(e)
			}
			if !published {
				if e = s.InstallDeclared(page.SHA256, bytes.NewReader(data)); e != nil {
					t.Fatal(e)
				}
				if e = s.AttachInventory(id, page.SHA256); e != nil {
					t.Fatal(e)
				}
			}
			var inventory wire.InventoryPage
			if e = wire.Decode(data, &inventory); e != nil {
				t.Fatal(e)
			}
			objects = append(objects, inventory.Objects...)
		}
		install := func(object wire.Object) {
			data, err := os.ReadFile(filepath.Join(input.Export, "objects", object.SHA256))
			if err != nil {
				t.Fatal(err)
			}
			if err = s.InstallDeclared(object.SHA256, bytes.NewReader(data)); err != nil {
				t.Fatal(err)
			}
		}
		if resume == "" && !published {
			for n, object := range objects {
				install(object)
				if (n+1)%10000 == 0 {
					t.Logf("installed %d/%d producer payloads", n+1, len(objects))
				}
			}
		} else {
			uploaded := 0
			for pages := 0; pages <= len(objects); pages++ {
				missing, err := s.Missing(id)
				if err != nil {
					t.Fatal(err)
				}
				if len(missing) == 0 {
					break
				}
				if published {
					t.Fatal("published real fixture has missing content")
				}
				if pages == len(objects) {
					t.Fatal("resumed missing-object import did not converge")
				}
				for _, object := range missing {
					install(object)
					uploaded++
				}
			}
			t.Logf("resumed real import installed %d missing payloads", uploaded)
		}
		t.Logf("committing producer export %s", filepath.Base(input.Export))
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
	for _, input := range inputs {
		if input.Disassembly != "" {
			for reportID, source := range reportSources {
				if source == input.Source {
					verifyRealDisassembly(t, s, h, revision, input.Disassembly, reportID)
				}
			}
		}
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
		var original []byte
		if file.Name != "report.tar.gz" {
			original, e = os.ReadFile(filepath.Join(reportSources[file.ReportID], file.Name))
			if e != nil {
				t.Fatal(e)
			}
		}
		var assembled []byte
		for _, chunk := range file.Chunks {
			response := realFixtureGET(t, h, "/api/v1/files/"+record.ID+"/chunks/"+chunk.SHA256+"?revision="+revision)
			if response.Code != 200 {
				t.Fatal("original file chunk unavailable", response.Code, response.Body.String())
			}
			assembled = append(assembled, response.Body.Bytes()...)
		}
		if file.Name == "report.tar.gz" {
			original = assembled
			verifyRealReportArchive(t, assembled, reportSources[file.ReportID], file)
		}
		whole := realFixtureGET(t, h, "/api/v1/files/"+record.ID+"/download?revision="+revision)
		if whole.Code != 200 || !bytes.Equal(whole.Body.Bytes(), original) {
			t.Fatal("whole analytical-file download drift", file.Name, whole.Code)
		}
		if !bytes.Equal(assembled, original) || wire.Hash(original) != file.SHA256 {
			t.Fatal("analytical file drift", file.Name)
		}
	}
	t.Logf("preserved %d original analytical/archive resources through HTTP", len(files))
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
				w := realFixtureGET(t, h, "/api/v1/reports/"+reportID+"/evidence?revision="+revision+"&chunk="+id)
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
	rssEligible := map[string]int{}
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
				if r.Metric == "process.rss" && r.MeasurementMethod != nil && r.MeasurementMethod.Status == "available" && r.MeasurementMethod.CollectorStatus == "recorded" {
					id := r.EnvironmentID + "|" + r.TrackID + "|" + r.MeasurementMethodID
					var summary struct {
						Value    float64 `json:"median_bytes"`
						Launches int     `json:"independent_launches"`
					}
					var recipe struct{ Options struct{ Launches int } }
					_ = json.Unmarshal(a, &summary)
					_ = json.Unmarshal(r.MeasurementMethod.Recipe, &recipe)
					if summary.Value > 0 && summary.Launches > 0 && summary.Launches == recipe.Options.Launches {
						rssEligible[id]++
					}
					scopes[id] = store.CohortScope{Revision: revision, Environment: r.EnvironmentID, Lanes: []string{r.TrackID}, LaneKind: "track", Baseline: r.TrackID, Selectors: []store.CohortSelector{{Definition: r.MetricDefinitionID, Method: r.MeasurementMethodID, Analysis: r.AnalysisVersion}}, Policy: "available-rss-arithmetic-v1", Weighting: "workload", Workloads: "all", MixedConfigurations: "explicit-membership", Collectors: "require-recorded", Definitions: "require-registered", Contracts: "latest-in-scope"}
				}
			}
			if r.Metric == "native.code_size" || r.Metric == "native.code_image" {
				var summary struct {
					Size     json.RawMessage `json:"size_bytes"`
					Trial    string          `json:"trial_id"`
					Artifact string          `json:"artifactId"`
				}
				_ = json.Unmarshal(r.Summary, &summary)
				want := codeExpected[r.ReportID+"|"+r.Runtime+"|"+r.Workload+"|"+summary.Trial+"|"+r.Metric]
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
	for id, scope := range scopes {
		c, e := s.ComputeCohort(context.Background(), scope)
		if e != nil {
			t.Fatal("real cohort incompatible", e)
		}
		if len(c.Comparison.Populations) != 1 {
			t.Fatal("unexpected scope population")
		}
		p := c.Comparison.Populations[0]
		if scope.Policy == "available-rss-arithmetic-v1" && p.Count != rssEligible[id] {
			t.Fatal("RSS cohort source population drift", p.Count, rssEligible[id])
		}
		if p.Count == 0 {
			continue
		}
		sum := 0.0
		for _, m := range p.Members {
			var r wire.Result
			record, e := s.Record(revision, "result", m.Cell.Result)
			if e != nil {
				t.Fatal(e)
			}
			_ = wire.Decode(record.Data, &r)
			var summary map[string]json.RawMessage
			_ = json.Unmarshal(r.Summary, &summary)
			var value float64
			if e = json.Unmarshal(summary[r.Statistic], &value); e != nil {
				t.Fatal("source aggregate value", e)
			}
			if scope.Policy == "available-rss-arithmetic-v1" {
				sum += value
			} else {
				sum += math.Log(value)
			}
		}
		want := sum / float64(p.Count)
		if scope.Policy == "shared-geometric-v1" {
			want = math.Exp(want)
		}
		if math.Abs(*p.Value-want) > want*1e-12 || *p.Ratio != 1 {
			t.Fatal("source-derived point estimate drift")
		}
		b, _ := wire.Encode(scope)
		w := realFixtureGET(t, h, "/api/v1/aggregates?scope="+url.QueryEscape(string(b)))
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
		w = realFixtureGET(t, h, "/api/v1/overview?scope="+url.QueryEscape(string(b)))
		var overview overviewResponse
		if w.Code != 200 || w.Body.Len() > 50*1024 || json.Unmarshal(w.Body.Bytes(), &overview) != nil || overview.Digest != c.Digest || len(overview.Cards) != 1 || overview.Cards[0].Count != p.Count || overview.Cards[0].Value == nil || *overview.Cards[0].Value != *p.Value || overview.Cards[0].Ratio == nil || *overview.Cards[0].Ratio != 1 {
			t.Fatal("HTTP overview/source parity drift", w.Code, w.Body.String())
		}
		w = realFixtureGET(t, h, "/api/v1/cohorts/"+response.Cohort+"?limit=1")
		if w.Code != 200 {
			t.Fatal("real membership failed", w.Code, w.Body.String())
		}
	}
	t.Logf("verified-source summaries retained: timing=%d memory=%d native-size=%d; exact environment/track/method scopes=%d", matched, memoryMatched, codeMatched, len(scopes))
	if len(files) > 0 {
		frozenPages := map[string][]byte{}
		for _, endpoint := range []string{"results", "history"} {
			base := "/api/v1/" + endpoint + "?revision=" + revision + "&limit=1"
			path := base
			for page := 0; page < 2; page++ {
				w := realFixtureGET(t, h, path)
				var response struct{ NextCursor string }
				if w.Code != 200 || w.Body.Len() > wire.ResponseBytes || json.Unmarshal(w.Body.Bytes(), &response) != nil {
					t.Fatal("freeze real recovery page", path, w.Code)
				}
				frozenPages[path] = append([]byte(nil), w.Body.Bytes()...)
				if response.NextCursor == "" {
					break
				}
				path = base + "&cursor=" + url.QueryEscape(response.NextCursor)
			}
		}
		t.Log("starting real backup/rebuild qualification")
		backup := filepath.Join(t.TempDir(), "backup")
		if _, e = s.Backup(context.Background(), backup); e != nil {
			t.Fatal(e)
		}
		t.Log("real backup completed; starting DB-free rebuild")
		rebuilt := filepath.Join(t.TempDir(), "rebuilt")
		if e = store.Rebuild(backup, rebuilt, "real-source-parity"); e != nil {
			t.Fatal(e)
		}
		t.Log("real rebuild completed; opening recovered store")
		recovered, e := store.Open(rebuilt, "real-source-parity")
		if e != nil {
			t.Fatal(e)
		}
		defer recovered.Close()
		recoveredKey, err := recovered.CursorKey()
		if err != nil || !bytes.Equal(recoveredKey, key) {
			t.Fatal("portable cursor identity drift", err)
		}
		recoveredHandler, err := New(recovered, strings.Repeat("x", 32), recoveredKey)
		if err != nil {
			t.Fatal(err)
		}
		for path, expected := range frozenPages {
			w := realFixtureGET(t, recoveredHandler, path)
			if w.Code != 200 || !bytes.Equal(w.Body.Bytes(), expected) {
				t.Fatal("portable frozen page/cursor drift", path, w.Code)
			}
		}
		recoveredRows, err := recovered.Results(store.Query{Revision: revision}, true)
		if err != nil || len(recoveredRows) != len(rows) {
			t.Fatal("portable result population drift", len(recoveredRows), len(rows), err)
		}
		expectedRows := make(map[string][]byte, len(rows))
		for _, record := range rows {
			body, err := wire.Encode(record)
			if err != nil || expectedRows[record.ID] != nil {
				t.Fatal("invalid original result identity", record.ID, err)
			}
			expectedRows[record.ID] = body
		}
		for _, record := range recoveredRows {
			body, err := wire.Encode(record)
			if err != nil || !bytes.Equal(body, expectedRows[record.ID]) {
				t.Fatal("portable scientific result/provenance drift", record.ID, err)
			}
			delete(expectedRows, record.ID)
		}
		if len(expectedRows) != 0 {
			t.Fatal("portable result identities disappeared", len(expectedRows))
		}
		t.Logf("portable scientific result/provenance parity: %d canonical rows", len(recoveredRows))
		for _, record := range files {
			descriptor, reader, e := recovered.OpenReportFile(context.Background(), revision, record.ID)
			if e != nil {
				t.Fatal(e)
			}
			digest := sha256.New()
			n, e := io.Copy(digest, reader)
			if e != nil || n != descriptor.Bytes || hex.EncodeToString(digest.Sum(nil)) != descriptor.SHA256 {
				t.Fatal("portable original/archive resource drift", descriptor.Name, e)
			}
		}
	}
}

func verifyRealReportArchive(t *testing.T, body []byte, source string, file wire.ReportFile) {
	t.Helper()
	seal, e := os.ReadFile(filepath.Join(source, "checksums.json"))
	if e != nil {
		t.Fatal(e)
	}
	if wire.Hash(seal) != file.SourceSealSHA256 {
		t.Fatal("archive source seal differs")
	}
	var expected map[string]string
	if e = json.Unmarshal(seal, &expected); e != nil {
		t.Fatal(e)
	}
	expected["checksums.json"] = wire.Hash(seal)
	gz, e := gzip.NewReader(bytes.NewReader(body))
	if e != nil {
		t.Fatal(e)
	}
	defer gz.Close()
	reader := tar.NewReader(gz)
	seen := map[string]bool{}
	for {
		entry, e := reader.Next()
		if e == io.EOF {
			break
		}
		if e != nil {
			t.Fatal(e)
		}
		want, ok := expected[entry.Name]
		if !ok || seen[entry.Name] || entry.Typeflag != tar.TypeReg {
			t.Fatal("archive contains unsealed or duplicate entry", entry.Name)
		}
		seen[entry.Name] = true
		hash := sha256.New()
		if _, e = io.Copy(hash, reader); e != nil {
			t.Fatal(e)
		}
		if hex.EncodeToString(hash.Sum(nil)) != want {
			t.Fatal("archived original file differs", entry.Name)
		}
	}
	if len(seen) != len(expected) {
		t.Fatal("archive lost sealed files", len(seen), len(expected))
	}
	t.Logf("verified %d original sealed files in %d-byte report archive", len(seen), len(body))
}
