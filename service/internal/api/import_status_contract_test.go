package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func TestImportStatusHTTPContractsAndCancellation(t *testing.T) {
	a, h := telemetryAPI(t, nil)
	headers := map[string]string{"Authorization": "Bearer " + a.Token}
	job, objects, err := testutil.Fixture("status-contract", time.Date(2026, 10, 6, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	id, err := a.Store.Submit(job)
	if err != nil {
		t.Fatal(err)
	}
	path := "/admin/v1/imports/" + id
	check := func(state string) store.ImportStatus {
		t.Helper()
		response := request(t, h, "GET", path, nil, headers)
		var status store.ImportStatus
		if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &status) != nil || status.ID != id || status.State != state {
			t.Fatal("invalid import status", response.Code, response.Body.String())
		}
		return status
	}
	if staged := check("staged"); staged.Missing == 0 || staged.Revision != "" || a.Store.Current() != "" {
		t.Fatal("staging advertised publication", staged)
	}
	response := request(t, h, "GET", path+"/missing", nil, headers)
	var missing struct {
		Items []wire.Object `json:"items"`
	}
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &missing) != nil || len(missing.Items) == 0 || len(missing.Items) > 100 {
		t.Fatal("invalid missing-object page", response.Code, response.Body.String())
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	req := httptest.NewRequest("GET", path, nil).WithContext(ctx)
	req.Header.Set("Authorization", "Bearer "+a.Token)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 503 || check("staged").Missing == 0 {
		t.Fatal("canceled status ignored or changed import", w.Code)
	}
	req = httptest.NewRequest("POST", path+"/abort", nil).WithContext(ctx)
	req.Header.Set("Authorization", "Bearer "+a.Token)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 503 || check("staged").Missing == 0 {
		t.Fatal("canceled abort ignored or changed import", w.Code)
	}
	for hash, data := range objects {
		if err := a.Store.Install(hash, bytes.NewReader(data)); err != nil {
			t.Fatal(err)
		}
	}
	revision, err := a.Store.Commit(id)
	if err != nil {
		t.Fatal(err)
	}
	if status := check("published"); status.Revision != revision || status.Missing != 0 || !status.MissingComplete {
		t.Fatal("publication receipt differs", status)
	}
	other, _, err := testutil.Fixture("status-aborted", time.Date(2026, 10, 6, 1, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	id, err = a.Store.Submit(other)
	if err != nil {
		t.Fatal(err)
	}
	path = "/admin/v1/imports/" + id
	if err := a.Store.Abort(id); err != nil {
		t.Fatal(err)
	}
	if status := check("aborted"); status.Revision != "" || a.Store.Current() != revision {
		t.Fatal("abort changed publication", status)
	}
}
