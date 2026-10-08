package api

import (
	"bytes"
	"encoding/json"
	"net/url"
	"strings"
	"testing"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func TestMatrixKeepsUseCasesTogetherAcrossPagesAndRuntimeSort(t *testing.T) {
	s, err := store.Open(t.TempDir(), "category-test")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	revision := importCohort(t, s, "categories", []testutil.CohortCell{
		{Runtime: "wago", Version: "1", Workload: "app/a-json", Group: "JSON & serialization", Value: 1},
		{Runtime: "wago", Version: "1", Workload: "app/b-zip", Group: "Compression", Value: 20},
		{Runtime: "wago", Version: "1", Workload: "app/c-json", Group: "JSON & serialization", Value: 5},
		{Runtime: "wago", Version: "1", Workload: "app/z-zip", Group: "Compression", Value: 10},
	})
	rows, err := s.ResultsContext(t.Context(), store.Query{Revision: revision}, false)
	if err != nil {
		t.Fatal(err)
	}
	var source wire.Result
	_ = wire.Decode(rows[0].Data, &source)
	h, err := New(s, strings.Repeat("x", 32), bytes.Repeat([]byte{7}, 32))
	if err != nil {
		t.Fatal(err)
	}
	for _, sorted := range []bool{false, true} {
		q := url.Values{"revision": {revision}, "environment": {source.EnvironmentID}, "metric": {source.Metric}, "scenario": {source.Scenario}, "profile": {source.Profile}, "statistic": {source.Statistic}, "limit": {"1"}, "tracks": {`["` + source.TrackID + `"]`}, "version": {"matrix-v3"}}
		if sorted {
			q.Set("sortTrack", source.TrackID)
			q.Set("direction", "asc")
		}
		groups := []string{}
		names := []string{}
		for {
			response := request(t, h, "GET", "/api/v1/matrix?"+q.Encode(), nil, nil)
			if response.Code != 200 {
				t.Fatal(response.Body.String())
			}
			var page struct {
				Items      []matrixRow
				NextCursor string
			}
			_ = json.Unmarshal(response.Body.Bytes(), &page)
			for _, row := range page.Items {
				groups = append(groups, row.Group)
				var metadata struct{ ID string }
				_ = json.Unmarshal(row.Workload.Data, &metadata)
				names = append(names, metadata.ID)
			}
			if page.NextCursor == "" {
				break
			}
			q.Set("cursor", page.NextCursor)
		}
		if strings.Join(groups, "|") != "Compression|Compression|JSON & serialization|JSON & serialization" {
			t.Fatal("categories scattered across pages", groups)
		}
		if sorted && names[0] != "app/z-zip" {
			t.Fatal("runtime sorting did not apply inside category", names)
		}
	}
}
