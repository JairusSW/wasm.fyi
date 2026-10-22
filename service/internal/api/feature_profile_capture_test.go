package api

import (
	"context"
	"encoding/json"
	"github.com/JairusSW/wasm.fyi/service/internal/benchdb"
	"github.com/JairusSW/wasm.fyi/service/internal/sqldb"
	"net/http"
	"strings"
	"testing"
)

func TestFeatureProfileCaptureSQLRoundTrip(t *testing.T) {
	db, err := sqldb.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	token := strings.Repeat("t", 32)
	handler, err := NewBenchmarks(db, token, DefaultRequestLimits(), nil)
	if err != nil {
		t.Fatal(err)
	}
	capture := benchdb.Capture{CapturedAt: "2026-10-22T00:00:00Z", Platform: benchdb.Platform{OS: "linux", Arch: "amd64", CPU: "Fixture", Cores: 8, Kernel: "test"}, Results: []benchdb.Row{{Workload: "features/gc/test/1", Wasm: "test.wasm", Artifact: strings.Repeat("a", 64), Contract: strings.Repeat("b", 64), Engine: "wamr", Version: "test", Backend: "interpreter", Phase: "first-call", Status: "unsupported", MemoryStatus: "unsupported", CodeStatus: "unsupported"}}}
	body, _ := json.Marshal(capture)
	var payload map[string]any
	json.Unmarshal(body, &payload)
	payload["featureProfile"] = "classic"
	body, _ = json.Marshal(payload)
	reply := request(t, handler, http.MethodPost, "/api/captures", body, map[string]string{"Authorization": "Bearer " + token, "Content-Type": "application/json"})
	if reply.Code != 200 {
		t.Fatal(reply.Code, reply.Body.String())
	}
	catalog, err := db.Platforms(context.Background())
	if err != nil || len(catalog.Items) != 1 {
		t.Fatal(catalog, err)
	}
	matrix, err := db.Matrix(context.Background(), sqldb.MatrixQuery{Platform: catalog.Items[0].ID, Phase: "first-call", Limit: 1})
	if err != nil || len(matrix.Items) != 1 {
		t.Fatal(matrix, err)
	}
	detail, err := db.Detail(context.Background(), catalog.Items[0].ID, matrix.Items[0].ObservationID)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(detail)
	var decoded map[string]any
	json.Unmarshal(encoded, &decoded)
	if decoded["featureProfile"] != "classic" {
		t.Fatal("profile not retained", string(encoded))
	}
	for _, profile := range []string{"../classic", strings.Repeat("x", 33), "classic\n"} {
		payload["featureProfile"] = profile
		body, _ = json.Marshal(payload)
		if r := request(t, handler, http.MethodPost, "/api/captures", body, map[string]string{"Authorization": "Bearer " + token, "Content-Type": "application/json"}); r.Code != 400 {
			t.Fatal("invalid profile accepted", profile, r.Code)
		}
	}
}
