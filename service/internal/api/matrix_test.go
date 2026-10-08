package api

import (
	"bytes"
	"encoding/json"
	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestMatrixScopeAndCompleteGroupMeans(t *testing.T) {
	s, err := store.Open(t.TempDir(), "matrix-test")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	h, err := New(s, strings.Repeat("x", 32), bytes.Repeat([]byte{7}, 32))
	if err != nil {
		t.Fatal(err)
	}
	revision := importFixture(t, s, "matrix", time.Now().UTC())
	records, err := s.ResultsContext(t.Context(), store.Query{Revision: revision}, false)
	if err != nil {
		t.Fatal(err)
	}
	var source wire.Result
	for _, record := range records {
		_ = json.Unmarshal(record.Data, &source)
		if source.Metric == "time.wall" {
			break
		}
	}
	values := url.Values{"revision": {revision}, "environment": {source.EnvironmentID}, "metric": {source.Metric}, "scenario": {source.Scenario}, "profile": {source.Profile}, "statistic": {source.Statistic}, "limit": {"1"}, "tracks": {`["` + source.TrackID + `"]`}}
	for _, mode := range []string{"shared", "per-engine"} {
		toggled := request(t, h, http.MethodGet, "/api/v1/matrix?"+values.Encode()+"&cohortMode="+mode, nil, nil)
		if toggled.Code != 200 {
			t.Fatalf("%s: %s", mode, toggled.Body.String())
		}
	}
	path := "/api/v1/matrix?" + values.Encode()
	page := request(t, h, http.MethodGet, path, nil, nil)
	if page.Code != 200 {
		t.Fatal(page.Body.String())
	}
	var result struct {
		Revision string
		Items    []matrixRow
		Groups   []struct {
			Name  string
			Total int
			Cells []struct {
				Count int
				Value *float64
			}
		}
		Total      int
		NextCursor string
	}
	if err = json.Unmarshal(page.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Revision != revision || len(result.Items) != 1 || result.Total < 1 || len(result.Groups) == 0 {
		t.Fatalf("unexpected page: %s", page.Body.String())
	}
	if strings.Contains(page.Body.String(), `"launch_medians":`) || strings.Contains(page.Body.String(), "measurementMethod\"") {
		t.Fatal("matrix preloaded source evidence: " + page.Body.String())
	}
	for _, group := range result.Groups {
		if group.Total < 1 {
			t.Fatal("empty group")
		}
		for _, cell := range group.Cells {
			if cell.Count > 0 && cell.Value == nil {
				t.Fatal("missing complete-population mean")
			}
		}
	}
	changed := values
	changed.Set("search", "no-such-workload")
	empty := request(t, h, http.MethodGet, "/api/v1/matrix?"+changed.Encode(), nil, nil)
	if empty.Code != 200 || !strings.Contains(empty.Body.String(), `"total":0`) {
		t.Fatal(empty.Body.String())
	}
	availability := request(t, h, http.MethodGet, "/api/v1/availability?revision="+revision+"&environment="+source.EnvironmentID, nil, nil)
	if availability.Code != 200 {
		t.Fatal(availability.Body.String())
	}
	if strings.Contains(availability.Body.String(), `"launch_medians":`) || strings.Contains(availability.Body.String(), "sourceSealSha256") {
		t.Fatal("availability preloaded reports")
	}
	if result.NextCursor != "" {
		changed.Set("cursor", result.NextCursor)
		bad := request(t, h, http.MethodGet, "/api/v1/matrix?"+changed.Encode(), nil, nil)
		if bad.Code != 400 {
			t.Fatal("cursor survived changed filter")
		}
	}
}

func TestMatrixPrefersMemoryPassOnlyForTiedMemoryCaptures(t *testing.T) {
	for _, test := range []struct {
		profile, id, oldProfile, oldID, metric string
		want                                   bool
	}{
		{"memory", "a", "timing", "z", "process.peak_rss", true},
		{"timing", "z", "memory", "a", "process.rss", false},
		{"timing", "z", "timing", "a", "process.rss", true},
		{"memory", "a", "timing", "z", "time.wall", false},
	} {
		if got := preferredMatrixResult(test.profile, test.id, test.oldProfile, test.oldID, test.metric); got != test.want {
			t.Fatalf("%+v: got %v", test, got)
		}
	}
}
