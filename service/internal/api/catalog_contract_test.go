package api

import (
	"bytes"
	"encoding/json"
	"net/url"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func TestCatalogAndRecordDetailContracts(t *testing.T) {
	a, h := telemetryAPI(t, nil)
	a.results = &resultCache{entries: map[string]resultCacheEntry{}}
	date := time.Date(2026, 10, 6, 0, 0, 0, 0, time.UTC)
	revision := importFixture(t, a.Store, "catalog-contract", date)
	kinds := map[string]string{"reports": "report", "tracks": "track", "metrics": "metric", "configurations": "configuration", "environments": "environment", "workloads": "workload", "artifacts": "artifact", "results": "result"}
	frozen := map[string][]byte{}
	type page struct {
		Revision string        `json:"revision"`
		Items    []wire.Record `json:"items"`
		Next     string        `json:"nextCursor"`
		Complete bool          `json:"complete"`
		Total    int           `json:"total"`
	}
	for route, kind := range kinds {
		t.Run(route, func(t *testing.T) {
			path := "/api/v1/" + route + "?revision=" + revision + "&limit=1"
			w := request(t, h, "GET", path, nil, nil)
			var first page
			if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &first) != nil || first.Revision != revision || len(first.Items) != 1 || first.Total < 1 || first.Complete != (first.Next == "") {
				t.Fatal("invalid bounded catalog page", w.Code, w.Body.String())
			}
			frozen[path] = bytes.Clone(w.Body.Bytes())
			r := first.Items[0]
			if r.Kind != kind {
				t.Fatal("catalog record kind differs", r.Kind, kind)
			}
			detailPath := "/api/v1/" + route + "/" + r.ID + "?revision=" + revision
			detailResponse := request(t, h, "GET", detailPath, nil, nil)
			var detail struct {
				Revision string      `json:"revision"`
				Record   wire.Record `json:"record"`
			}
			if detailResponse.Code != 200 || json.Unmarshal(detailResponse.Body.Bytes(), &detail) != nil || detail.Revision != revision || detail.Record.Kind != kind || detail.Record.ID != r.ID {
				t.Fatal("invalid record detail", detailResponse.Code, detailResponse.Body.String())
			}
			frozen[detailPath] = bytes.Clone(detailResponse.Body.Bytes())
			stored, err := a.Store.Record(revision, kind, r.ID)
			if err != nil || string(stored.Data) != string(detail.Record.Data) {
				t.Fatal("canonical detail changed", err)
			}
			if first.Next != "" {
				next := request(t, h, "GET", path+"&cursor="+url.QueryEscape(first.Next), nil, nil)
				var second page
				if next.Code != 200 || json.Unmarshal(next.Body.Bytes(), &second) != nil || second.Revision != revision || second.Total != first.Total || len(second.Items) != 1 || second.Items[0].ID == r.ID {
					t.Fatal("invalid catalog successor", next.Code, next.Body.String())
				}
			}
		})
	}
	if latest := importFixture(t, a.Store, "catalog-contract-next", date.Add(time.Hour)); latest == revision {
		t.Fatal("fixture did not publish another revision")
	}
	for path, expected := range frozen {
		response := request(t, h, "GET", path, nil, nil)
		if response.Code != 200 || !bytes.Equal(response.Body.Bytes(), expected) {
			t.Fatal("pinned catalog/detail changed after publication", path, response.Code)
		}
	}
}
