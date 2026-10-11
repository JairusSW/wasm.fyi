package api

import (
	"context"
	"encoding/json"
	"github.com/JairusSW/wasm.fyi/service/internal/sqldb"
	"net/http/httptest"
	"os"
	"sort"
	"testing"
	"time"
)

// Opt-in real-data acceptance, always run under the device reservation.
func TestCompactSQLRealCopy(t *testing.T) {
	directory := os.Getenv("WASMFYI_SQL_TEST_COPY")
	if directory == "" {
		t.Skip("no copied real dataset")
	}
	db, err := sqldb.Open(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	handler, err := NewBenchmarks(db, string(make([]byte, 32)), DefaultRequestLimits(), nil)
	if err != nil {
		t.Fatal(err)
	}
	summary, err := db.Summary(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(summary.Platforms) != 3 {
		t.Fatalf("expected three copied hosts, got %d", len(summary.Platforms))
	}
	request := func(path string) ([]byte, time.Duration) {
		t.Helper()
		w := httptest.NewRecorder()
		r := httptest.NewRequest("GET", path, nil)
		r.RemoteAddr = "127.0.0.1:1234"
		started := time.Now()
		handler.ServeHTTP(w, r)
		elapsed := time.Since(started)
		if w.Code != 200 {
			t.Fatalf("%s: %d %s", path, w.Code, w.Body.String())
		}
		return w.Body.Bytes(), elapsed
	}
	data, elapsed := request("/api/summary")
	if len(data) > 100000 {
		t.Fatal("summary exceeded startup bound")
	}
	t.Logf("summary bytes=%d handler=%s", len(data), elapsed)
	for _, platform := range summary.Platforms {

		historyPath := "/api/history/summary?platform=" + platform.ID + "&metric=exec"
		historyBody, coldHistory := request(historyPath)
		_, warmHistory := request(historyPath)
		var history sqldb.HistoricalSummaryResult
		if err = json.Unmarshal(historyBody, &history); err != nil {
			t.Fatal(err)
		}
		if len(history.Items) == 0 || len(historyBody) > 1<<20 {
			t.Fatal("missing or unbounded history graph")
		}
		t.Logf("history host=%s bytes=%d dates=%d cold=%s warm=%s", platform.CPU, len(historyBody), len(history.Items), coldHistory, warmHistory)
		path := "/api/matrix?platform=" + platform.ID + "&phase=steady&limit=1000"
		timings := []time.Duration{}
		var page compactMatrix
		size := 0
		for i := 0; i < 7; i++ {
			data, elapsed = request(path)
			size = len(data)
			timings = append(timings, elapsed)
			if err = json.Unmarshal(data, &page); err != nil {
				t.Fatal(err)
			}
		}
		sort.Slice(timings, func(i, j int) bool { return timings[i] < timings[j] })
		t.Logf("host=%s first1000 bytes=%d p50=%s max=%s total=%d", platform.CPU, size, timings[3], timings[6], page.Total)
		if len(page.Rows) == 0 {
			t.Fatal("empty copied matrix")
		}
		id := int64(page.Rows[0][0].(float64))
		detail, err := db.Detail(context.Background(), platform.ID, id)
		if err != nil {
			t.Fatal(err)
		}
		if detail.Status == "ok" && detail.TimingSamples > 0 && len(detail.SamplesNs) == 0 {
			t.Fatal("detail lost ordered samples")
		}
	}
}
