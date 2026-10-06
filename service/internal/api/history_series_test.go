package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func historyPlotRow(t *testing.T, i int, value any, status string) wire.Record {
	t.Helper()
	summary, _ := json.Marshal(map[string]any{"value": value, "status": status})
	data, _ := wire.Encode(wire.Result{Statistic: "value", Summary: summary})
	return wire.Record{Kind: "result", ID: fmt.Sprint(i), Data: data}
}
func TestHistoryReductionPreservesExactExtremaGapsAndOriginals(t *testing.T) {
	rows := []wire.Record{}
	for i := 0; i < 100; i++ {
		rows = append(rows, historyPlotRow(t, i, i, "available"))
	}
	rows[12] = historyPlotRow(t, 12, "9007199254740993", "available")
	rows[13] = historyPlotRow(t, 13, "9007199254740992", "available")
	rows[50] = historyPlotRow(t, 50, nil, "unavailable")
	selected, e := reduceHistory(context.Background(), rows, 24)
	if e != nil || len(selected) > 24 {
		t.Fatal(e, len(selected))
	}
	kept := map[string]bool{}
	for _, row := range selected {
		kept[row.ID] = true
		found := false
		for _, original := range rows {
			if row.ID == original.ID {
				if string(row.Data) != string(original.Data) {
					t.Fatal("original record altered")
				}
				found = true
			}
		}
		if !found {
			t.Fatal("invented history point")
		}
	}
	for _, required := range []string{"0", "99", "12", "49", "50", "51"} {
		if !kept[required] {
			t.Fatal("lost extrema/gap/boundary", required)
		}
	}
	for i := 0; i < 100; i += 2 {
		rows[i] = historyPlotRow(t, i, nil, "unavailable")
	}
	if _, e = reduceHistory(context.Background(), rows, 24); !errors.Is(e, store.ErrLimit) {
		t.Fatal("gap-heavy series silently reduced", e)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, e = reduceHistory(ctx, rows, 24); !errors.Is(e, context.Canceled) {
		t.Fatal(e)
	}
}
func TestHistorySeriesHTTPExactScopeAndFrozenRevision(t *testing.T) {
	a, h := telemetryAPI(t, nil)
	a.results = &resultCache{entries: map[string]resultCacheEntry{}}
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	first := importSeriesFixture(t, a.Store, "series-first", start)
	last := importSeriesFixture(t, a.Store, "series-last", start.Add(time.Hour))
	records, e := a.Store.Results(store.Query{Revision: last}, true)
	if e != nil {
		t.Fatal(e)
	}
	var result wire.Result
	if e = wire.Decode(records[0].Data, &result); e != nil {
		t.Fatal(e)
	}
	scope := store.Query{Revision: last, Environment: result.EnvironmentID, Track: result.TrackID, Contract: result.ContractID, Definition: result.MetricDefinitionID, Method: result.MeasurementMethodID, Scenario: result.Scenario, Profile: result.Profile, Statistic: result.Statistic, From: start.Format(time.RFC3339), Until: start.AddDate(0, 1, 0).Format(time.RFC3339)}
	path := func(q store.Query) string {
		raw, _ := wire.Encode(q)
		return "/api/v1/history/series?scope=" + url.QueryEscape(string(raw)) + "&version=" + historySeriesVersion + "&maxPoints=8"
	}
	response := request(t, h, "GET", path(scope), nil, nil)
	var out HistorySeries
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &out) != nil || out.Reduction != "raw" || out.RawCount != 2 || len(out.Items) != 2 || !strings.Contains(response.Header().Get("Cache-Control"), "immutable") {
		t.Fatal(response.Code, response.Body.String())
	}
	before := response.Body.String()
	importSeriesFixture(t, a.Store, "series-new-publication", start.Add(2*time.Hour))
	response = request(t, h, "GET", path(scope), nil, nil)
	if response.Code != 200 || response.Body.String() != before {
		t.Fatal("series changed with publication")
	}
	bad := scope
	bad.Contract = ""
	if request(t, h, "GET", path(bad), nil, nil).Code != 400 {
		t.Fatal("mixed contracts accepted")
	}
	bad = scope
	bad.Revision = first
	response = request(t, h, "GET", path(bad), nil, nil)
	if response.Code != 200 {
		t.Fatal(response.Code, response.Body.String())
	}
	for _, invalid := range []string{path(scope) + "&limit=1", strings.Replace(path(scope), "maxPoints=8", "maxPoints=1001", 1), strings.Replace(path(scope), historySeriesVersion, "old", 1)} {
		if request(t, h, "GET", invalid, nil, nil).Code != 400 {
			t.Fatal("invalid series request accepted")
		}
	}
}

func importSeriesFixture(t *testing.T, s *store.Store, seed string, date time.Time) string {
	t.Helper()
	job, objects, e := testutil.CohortFixture(seed, date, []testutil.CohortCell{{Runtime: "a", Workload: "fixture/one", Value: 4}})
	if e != nil {
		t.Fatal(e)
	}
	for id, body := range objects {
		if e = s.Install(id, bytes.NewReader(body)); e != nil {
			t.Fatal(e)
		}
	}
	id, e := s.Submit(job)
	if e != nil {
		t.Fatal(e)
	}
	revision, e := s.Commit(id)
	if e != nil {
		t.Fatal(e)
	}
	return revision
}

func TestHistorySeriesReducedHTTPKeepsOriginalIDsAndAdmission(t *testing.T) {
	a, h := telemetryAPI(t, nil)
	a.results = &resultCache{entries: map[string]resultCacheEntry{}}
	start := time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)
	revision := ""
	for i := 0; i < 12; i++ {
		revision = importSeriesFixture(t, a.Store, fmt.Sprintf("reduced-%d", i), start.Add(time.Duration(i)*time.Hour))
	}
	original, e := a.Store.Results(store.Query{Revision: revision}, true)
	if e != nil {
		t.Fatal(e)
	}
	var v wire.Result
	if e = wire.Decode(original[0].Data, &v); e != nil {
		t.Fatal(e)
	}
	scope := store.Query{Revision: revision, Environment: v.EnvironmentID, Track: v.TrackID, Contract: v.ContractID, Definition: v.MetricDefinitionID, Method: v.MeasurementMethodID, Scenario: v.Scenario, Profile: v.Profile, Statistic: v.Statistic, From: start.Format(time.RFC3339), Until: start.AddDate(0, 1, 0).Format(time.RFC3339)}
	raw, _ := wire.Encode(scope)
	path := "/api/v1/history/series?scope=" + url.QueryEscape(string(raw)) + "&version=" + historySeriesVersion + "&maxPoints=8"
	response := request(t, h, "GET", path, nil, nil)
	var out HistorySeries
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &out) != nil || out.RawCount != 12 || len(out.Items) > 8 || out.Reduction != "ordered-observation-buckets" {
		t.Fatal(response.Code, response.Body.String())
	}
	known := map[string]bool{}
	for _, r := range original {
		known[r.ID] = true
	}
	for _, r := range out.Items {
		if !known[r.ID] {
			t.Fatal("invented reduced result")
		}
	}
	for i := 0; i < cap(a.calculating); i++ {
		a.calculating <- struct{}{}
	}
	if response = request(t, h, "GET", path, nil, nil); response.Code != 429 {
		t.Fatal("reduction admission bypassed", response.Code)
	}
	for i := 0; i < cap(a.calculating); i++ {
		<-a.calculating
	}
}
