package api

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"path/filepath"
	"testing"
)

func TestHistoryCoverageWithoutMeasurementsFrozenRebuild(t *testing.T) {
	a, _ := telemetryAPI(t, nil)
	handler, err := New(a.Store, a.Token, a.CursorKey)
	if err != nil {
		t.Fatal(err)
	}
	publish := func(job wire.Job) string {
		t.Helper()
		id, err := a.Store.Submit(job)
		if err != nil {
			t.Fatal(err)
		}
		revision, err := a.Store.Commit(id)
		if err != nil {
			t.Fatal(err)
		}
		return revision
	}
	first, err := testutil.HistoryCoverageFixture("coverage-a", "darwin/arm64")
	if err != nil {
		t.Fatal(err)
	}
	id, err := a.Store.Submit(first)
	if err != nil {
		t.Fatal(err)
	}
	data, err := wire.HistoryCoverageData(first.HistoryCoverage[0])
	if err != nil {
		t.Fatal(err)
	}
	staged := request(t, handler, "GET", "/api/v1/history/coverage/"+wire.Hash(first.HistoryCoverage[0]), nil, nil)
	if staged.Code != 404 {
		t.Fatal("staging coverage visible", staged.Code)
	}
	initial, err := a.Store.Commit(id)
	if err != nil {
		t.Fatal(err)
	}
	other, err := testutil.HistoryCoverageFixture("coverage-b", "linux/amd64")
	if err != nil {
		t.Fatal(err)
	}
	second := publish(other)
	path := "/api/v1/history/coverage?revision=" + second + "&limit=1"
	frozen := request(t, handler, "GET", path, nil, nil)
	var page struct {
		Items []wire.Record `json:"items"`
		Total int           `json:"total"`
		Next  string        `json:"nextCursor"`
	}
	if frozen.Code != 200 || json.Unmarshal(frozen.Body.Bytes(), &page) != nil || page.Total != 2 || page.Next == "" {
		t.Fatal(frozen.Code, frozen.Body.String())
	}
	scoped := request(t, handler, "GET", path+"&scope="+data.Scope(), nil, nil)
	if scoped.Code != 200 || json.Unmarshal(scoped.Body.Bytes(), &page) != nil || page.Total != 1 || page.Next != "" {
		t.Fatal("filter occurred after paging", scoped.Code, scoped.Body.String())
	}
	revised := first
	revised.Attempt = "coverage-a-retry"
	data.Status = "runner-error"
	recorded := "runner-error"
	data.RecordedStatus = &recorded
	revised.HistoryCoverage[0], _ = wire.Encode(data)
	latest := publish(revised)
	got := request(t, handler, "GET", "/api/v1/history/coverage?revision="+latest+"&scope="+data.Scope(), nil, nil)
	if got.Code != 200 || json.Unmarshal(got.Body.Bytes(), &page) != nil || page.Total != 1 {
		t.Fatal("coverage update duplicated a cell", got.Code, got.Body.String())
	}
	actual, err := wire.HistoryCoverageData(page.Items[0].Data)
	if err != nil || actual.Status != "runner-error" {
		t.Fatal("wrong selected coverage", err)
	}
	old := request(t, handler, "GET", "/api/v1/history/coverage?revision="+initial, nil, nil)
	if old.Code != 200 || !bytes.Contains(old.Body.Bytes(), []byte(`"status":"unavailable"`)) {
		t.Fatal("old state mutated", old.Code)
	}
	for _, route := range []string{"results", "history"} {
		response := request(t, handler, "GET", "/api/v1/"+route+"?revision="+latest, nil, nil)
		if response.Code != 200 || !bytes.Contains(response.Body.Bytes(), []byte(`"total":0`)) {
			t.Fatal("coverage manufactured observations", route, response.Code, response.Body.String())
		}
	}
	backup := filepath.Join(t.TempDir(), "backup")
	if _, err = a.Store.Backup(context.Background(), backup); err != nil {
		t.Fatal(err)
	}
	if _, err = store.VerifyBackup(context.Background(), backup); err != nil {
		t.Fatal(err)
	}
	rebuilt := filepath.Join(t.TempDir(), "rebuilt")
	if err = store.Rebuild(backup, rebuilt, "coverage"); err != nil {
		t.Fatal(err)
	}
	recovered, err := store.Open(rebuilt, "coverage")
	if err != nil {
		t.Fatal(err)
	}
	defer recovered.Close()
	h, err := New(recovered, a.Token, a.CursorKey)
	if err != nil {
		t.Fatal(err)
	}
	restored := request(t, h, "GET", path, nil, nil)
	if restored.Code != 200 || !bytes.Equal(restored.Body.Bytes(), frozen.Body.Bytes()) {
		t.Fatal("frozen coverage reconstruction drift", restored.Code)
	}
}
