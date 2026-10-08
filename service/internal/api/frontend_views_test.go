package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"net/http"
	"net/url"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"
)

func publishFrontendFixture(t *testing.T, s *store.Store, job wire.Job, objects map[string][]byte) string {
	t.Helper()
	for id, body := range objects {
		if err := s.Install(id, bytes.NewReader(body)); err != nil {
			t.Fatal(err)
		}
	}
	id, err := s.Submit(job)
	if err != nil {
		t.Fatal(err)
	}
	revision, err := s.Commit(id)
	if err != nil {
		t.Fatal(err)
	}
	return revision
}
func TestHistoryTimelineUsesDeclaredDatesAndRetainsReusedEvidence(t *testing.T) {
	s, err := store.Open(t.TempDir(), "timeline-test")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	h, err := New(s, strings.Repeat("x", 32), bytes.Repeat([]byte{8}, 32))
	if err != nil {
		t.Fatal(err)
	}
	var source wire.Result
	revision := ""
	for i, value := range []float64{1200, 1800} {
		job, objects, err := testutil.CohortFixture(string(rune('a'+i)), time.Date(2026, 10, 5+i, 0, 0, 0, 0, time.UTC), []testutil.CohortCell{{Runtime: "wasmtime", Version: "1.0.0", Workload: "fixture/a", Group: "A", Value: value}})
		if err != nil {
			t.Fatal(err)
		}
		for _, body := range objects {
			var record wire.Record
			_ = json.Unmarshal(body, &record)
			if record.Kind == "result" {
				_ = json.Unmarshal(record.Data, &source)
			}
		}
		dates := []string{"2026-01-01", "2026-01-08"}
		if i == 1 {
			dates = []string{"2026-01-15"}
		}
		job.History = []wire.HistoryBinding{{ReportID: source.ReportID, ConfigurationID: source.ConfigurationID, Policy: wire.HistoryBindingPolicy, TargetDates: dates, SourceRevision: strings.Repeat(string(rune('a'+i)), 40), BuildRole: "source"}}
		revision = publishFrontendFixture(t, s, job, objects)
	}
	values := url.Values{"revision": {revision}, "environment": {source.EnvironmentID}, "metric": {source.Metric}, "scenario": {source.Scenario}, "profile": {source.Profile}, "statistic": {source.Statistic}, "tracks": {`["` + source.TrackID + `"]`}, "weighting": {"workload"}, "from": {"2025-12-01"}, "until": {"2026-02-01"}, "before": {"2026-01-08"}, "after": {"2026-01-15"}}
	response := request(t, h, http.MethodGet, "/api/v1/history/timeline?"+values.Encode(), nil, nil)
	if response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	var output struct {
		Items   []timelinePoint
		Changes []struct {
			Before, After *float64
			Count         int
		}
		TimeAxis string
	}
	if err = json.Unmarshal(response.Body.Bytes(), &output); err != nil {
		t.Fatal(err)
	}
	if len(output.Items) != 3 || output.Items[0].Date != "2026-01-01" || output.Items[0].Lanes[0].Evidence != output.Items[1].Lanes[0].Evidence || output.Items[1].Lanes[0].Evidence == output.Items[2].Lanes[0].Evidence {
		t.Fatal(response.Body.String())
	}
	if len(output.Changes) != 1 || output.Changes[0].Count != 1 || output.Changes[0].Before == nil || output.Changes[0].After == nil || *output.Changes[0].Before != 1200 || *output.Changes[0].After != 1800 {
		t.Fatal(response.Body.String())
	}
	if strings.Contains(response.Body.String(), `"launch_medians":`) || strings.Contains(response.Body.String(), `"ci95_low":`) {
		t.Fatal("history invented/fetched uncertainty")
	}
	directory := filepath.Join(t.TempDir(), "history-index")
	if err = s.PrepareHistoryReadIndex(t.Context(), directory, nil); err != nil {
		t.Fatal(err)
	}
	index, err := store.OpenHistoryReadIndex(directory, revision)
	if err != nil {
		t.Fatal(err)
	}
	defer index.Close()
	a := h.(*API)
	a.historyIndex = index
	indexed := request(t, h, http.MethodGet, "/api/v1/history/timeline?"+values.Encode(), nil, nil)
	if indexed.Code != 200 || indexed.Body.String() != response.Body.String() {
		t.Fatal("indexed history changed values, roles, reuse or comparisons", indexed.Code, indexed.Body.String())
	}
	// Collection dates are in October, declared target dates are in January.
	// Target-date selection must find those observations and skip other dates.
	selected, err := index.Select(t.Context(), store.Query{Revision: revision, Environment: source.EnvironmentID, Metric: source.Metric, Scenario: source.Scenario, Profile: source.Profile, Statistic: source.Statistic}, "2026-01-08", "2026-01-09", []string{source.TrackID})
	if err != nil || selected.Scanned != 1 || len(selected.Rows) != 1 || len(selected.Bindings) != 1 {
		t.Fatalf("selected out-of-window history: scans=%d rows=%d err=%v", selected.Scanned, len(selected.Rows), err)
	}
}
func TestHistoryServingIndexMultiTrackPolicyParity(t *testing.T) {
	for _, metric := range []string{"time.wall", "process.rss", "native.code_size"} {
		t.Run(metric, func(t *testing.T) {
			s, err := store.Open(t.TempDir(), "history-index-policy-test")
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			h, err := New(s, strings.Repeat("x", 32), bytes.Repeat([]byte{8}, 32))
			if err != nil {
				t.Fatal(err)
			}
			tracks := map[string]bool{}
			var source wire.Result
			revision := ""
			for i := 0; i < 3; i++ {
				cells := []testutil.CohortCell{
					{Runtime: "wasmtime", Version: "1.0.0", Workload: "fixture/a", Group: "A", Metric: metric, Value: float64(100 + i*10)},
					{Runtime: "wago", Version: "1.0.0", Workload: "fixture/a", Group: "A", Metric: metric, Value: float64(200 + i*10)},
					{Runtime: "wasmtime", Version: "1.0.0", Workload: "fixture/b", Group: "B", Metric: metric, Value: 300, Failed: i == 0},
				}
				if i > 0 {
					cells = append(cells, testutil.CohortCell{Runtime: "wago", Version: "1.0.0", Workload: "fixture/b", Group: "B", Metric: metric, Value: 400})
				}
				job, objects, err := testutil.CohortFixture(string(rune('g'+i)), time.Date(2026, 10, 5+i, 0, 0, 0, 0, time.UTC), cells)
				if err != nil {
					t.Fatal(err)
				}
				configs := map[string]bool{}
				for _, body := range objects {
					var record wire.Record
					_ = json.Unmarshal(body, &record)
					if record.Kind == "result" {
						_ = json.Unmarshal(record.Data, &source)
						tracks[source.TrackID] = true
						configs[source.ConfigurationID] = true
					}
				}
				for config := range configs {
					job.History = append(job.History, wire.HistoryBinding{ReportID: source.ReportID, ConfigurationID: config, Policy: wire.HistoryBindingPolicy, TargetDates: []string{fmt.Sprintf("2026-01-%02d", 1+i*7)}, SourceRevision: strings.Repeat(string(rune('a'+i)), 40), BuildRole: "source"})
				}
				if i == 2 { // Staged history must not become visible in the prepared index.
					for id, body := range objects {
						if err = s.Install(id, bytes.NewReader(body)); err != nil {
							t.Fatal(err)
						}
					}
					if _, err = s.Submit(job); err != nil {
						t.Fatal(err)
					}
				} else {
					revision = publishFrontendFixture(t, s, job, objects)
				}
			}
			trackIDs := []string{}
			for id := range tracks {
				trackIDs = append(trackIDs, id)
			}
			sort.Strings(trackIDs)
			rawTracks, _ := json.Marshal(trackIDs)
			values := url.Values{"revision": {revision}, "environment": {source.EnvironmentID}, "metric": {source.Metric}, "scenario": {source.Scenario}, "profile": {source.Profile}, "statistic": {source.Statistic}, "tracks": {string(rawTracks)}, "weighting": {"corpus"}, "from": {"2025-12-01"}, "until": {"2026-02-01"}, "before": {"2026-01-01"}, "after": {"2026-01-08"}}
			path := "/api/v1/history/timeline?" + values.Encode()
			legacy := request(t, h, http.MethodGet, path, nil, nil)
			if legacy.Code != 200 {
				t.Fatal(legacy.Body.String())
			}
			directory := filepath.Join(t.TempDir(), "history-index")
			if err = s.PrepareHistoryReadIndex(t.Context(), directory, nil); err != nil {
				t.Fatal(err)
			}
			q := store.Query{Revision: revision, Environment: source.EnvironmentID, Selection: "current", Metric: source.Metric, Scenario: source.Scenario, Profile: source.Profile, Statistic: source.Statistic, Sort: "catalog"}
			population := q
			population.Scenario = ""
			if err = s.PrepareHistoryReferences(t.Context(), directory, []store.Query{population}, nil); err != nil {
				t.Fatal(err)
			}
			if wrong, err := store.OpenHistoryReadIndex(directory, strings.Repeat("a", 64)); err == nil {
				wrong.Close()
				t.Fatal("accepted different revision")
			}
			if err = s.PrepareHistoryReadIndex(t.Context(), directory, func(string, int) { t.Fatal("rebuilt complete index") }); err != nil {
				t.Fatal(err)
			}
			index, err := store.OpenHistoryReadIndex(directory, revision)
			if err != nil {
				t.Fatal(err)
			}
			defer index.Close()
			dates, err := index.CaptureDates(t.Context(), q, trackIDs)
			if err != nil || len(dates) != 2 || dates[0] != "2026-01-01" || dates[1] != "2026-01-08" {
				t.Fatal("capture dates omit published observations or expose staged evidence", dates, err)
			}
			reference, found, err := index.Reference(t.Context(), q)
			if err != nil || !found || len(reference.Rows) != 4 {
				t.Fatalf("current reference absent: %d %v %v", len(reference.Rows), found, err)
			}
			h.(*API).historyIndex = index
			indexed := request(t, h, http.MethodGet, path, nil, nil)
			if indexed.Code != 200 || indexed.Body.String() != legacy.Body.String() {
				t.Fatal("indexed history policy drift", indexed.Code, indexed.Body.String(), legacy.Body.String())
			}
			var output struct{ Items []timelinePoint }
			_ = json.Unmarshal(indexed.Body.Bytes(), &output)
			if len(output.Items) != 2 {
				t.Fatal("staged date exposed", indexed.Body.String())
			}
		})
	}
}

func TestFeatureSummaryKeepsFailuresAndLoadsContractsOnlyOnSelection(t *testing.T) {
	s, err := store.Open(t.TempDir(), "feature-summary-test")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	h, err := New(s, strings.Repeat("x", 32), bytes.Repeat([]byte{9}, 32))
	if err != nil {
		t.Fatal(err)
	}
	job, objects, err := testutil.FeatureFixture("features", time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	revision := publishFrontendFixture(t, s, job, objects)
	var source wire.FeatureProbe
	for _, body := range objects {
		var record wire.Record
		_ = json.Unmarshal(body, &record)
		if record.Kind == "feature-probe" {
			source, _ = wire.FeatureProbeData(record.Data)
		}
	}
	path := "/api/v1/feature-summary?revision=" + revision + "&environment=" + source.EnvironmentID
	summary := request(t, h, http.MethodGet, path, nil, nil)
	if summary.Code != 200 {
		t.Fatal(summary.Body.String())
	}
	if !strings.Contains(summary.Body.String(), `"failed":1`) || !strings.Contains(summary.Body.String(), `"unsupported":1`) || !strings.Contains(summary.Body.String(), `"contracts":[]`) {
		t.Fatal(summary.Body.String())
	}
	details := request(t, h, http.MethodGet, path+"&feature=simd&configuration="+source.ConfigurationID, nil, nil)
	if details.Code != 200 || !strings.Contains(details.Body.String(), `"workload":"features/simd/probe-0"`) {
		t.Fatal(details.Body.String())
	}
}
