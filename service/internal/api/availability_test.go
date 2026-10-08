package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func TestAvailabilityKeepsRSSRecordsButExcludesUnrecordedComparisonMethods(t *testing.T) {
	s, err := store.Open(t.TempDir(), "rss-availability")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	revision := importCohort(t, s, "rss-availability", []testutil.CohortCell{
		{Runtime: "wago", Version: "1", Workload: "app/a", Metric: "process.rss", Value: 100},
		{Runtime: "wago", Version: "1", Workload: "app/b", Metric: "process.rss", Value: 200, MethodUnavailable: true},
	})
	rows, err := s.ResultsContext(t.Context(), store.Query{Revision: revision}, false)
	if err != nil {
		t.Fatal(err)
	}
	var source wire.Result
	if err = wire.Decode(rows[0].Data, &source); err != nil {
		t.Fatal(err)
	}
	h, err := New(s, strings.Repeat("x", 32), bytes.Repeat([]byte{7}, 32))
	if err != nil {
		t.Fatal(err)
	}
	response := request(t, h, http.MethodGet, "/api/v1/availability?revision="+revision+"&environment="+source.EnvironmentID+"&metric=process.rss", nil, nil)
	if response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	var output struct{ Items []availableLane }
	if err = json.Unmarshal(response.Body.Bytes(), &output); err != nil {
		t.Fatal(err)
	}
	if len(output.Items) != 1 || len(output.Items[0].Metrics) != 1 {
		t.Fatal(response.Body.String())
	}
	metric := output.Items[0].Metrics[0]
	if metric.Results != 2 || len(metric.Selectors) != 1 {
		t.Fatal("unrecorded method admitted or evidence hidden", response.Body.String())
	}
}
