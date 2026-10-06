package api

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"net/url"
	"path/filepath"
	"testing"
	"time"
)

func TestFeatureProbeHTTPAndPortableRecovery(t *testing.T) {
	a, h := telemetryAPI(t, nil)
	j, objects, err := testutil.FeatureFixture("feature-probes", time.Date(2026, 10, 6, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	for hash, body := range objects {
		if err = a.Store.Install(hash, bytes.NewReader(body)); err != nil {
			t.Fatal(err)
		}
	}
	id, err := a.Store.Submit(j)
	if err != nil {
		t.Fatal(err)
	}
	revision, err := a.Store.Commit(id)
	if err != nil {
		t.Fatal(err)
	}
	path := "/api/v1/features?revision=" + revision + "&limit=1"
	first := request(t, h, "GET", path, nil, nil)
	var page struct {
		Items []wire.Record `json:"items"`
		Total int           `json:"total"`
		Next  string        `json:"nextCursor"`
	}
	if first.Code != 200 || json.Unmarshal(first.Body.Bytes(), &page) != nil || page.Total != 2 || len(page.Items) != 1 || page.Next == "" {
		t.Fatal(first.Code, first.Body.String())
	}
	selected := request(t, h, "GET", path+"&report="+j.Exports[0].Manifest.ReportID, nil, nil)
	if selected.Code != 200 || !bytes.Contains(selected.Body.Bytes(), []byte(`"total":2`)) {
		t.Fatal("selected report feature scope", selected.Code, selected.Body.String())
	}
	changedScope := request(t, h, "GET", path+"&report="+j.Exports[0].Manifest.ReportID+"&cursor="+url.QueryEscape(page.Next), nil, nil)
	if changedScope.Code != 400 {
		t.Fatal("feature cursor crossed report scope", changedScope.Code)
	}
	next := request(t, h, "GET", path+"&cursor="+url.QueryEscape(page.Next), nil, nil)
	var successor struct {
		Items []wire.Record `json:"items"`
	}
	if next.Code != 200 || json.Unmarshal(next.Body.Bytes(), &successor) != nil || len(successor.Items) != 1 || successor.Items[0].ID == page.Items[0].ID {
		t.Fatal("feature pagination", next.Code, next.Body.String())
	}
	for _, record := range append(page.Items, successor.Items...) {
		probe, e := wire.FeatureProbeData(record.Data)
		if e != nil {
			t.Fatal(e)
		}
		detail := request(t, h, "GET", "/api/v1/features/"+record.ID+"?revision="+revision, nil, nil)
		if detail.Code != 200 {
			t.Fatal(detail.Code, detail.Body.String())
		}
		evidence := request(t, h, "GET", "/api/v1/features/"+record.ID+"/evidence?revision="+revision+"&chunk="+probe.Evidence[0], nil, nil)
		if evidence.Code != 200 || !bytes.Equal(bytes.TrimSpace(evidence.Body.Bytes()), objects[probe.Evidence[0]]) {
			t.Fatal("feature evidence drift", evidence.Code, evidence.Body.String())
		}
		foreign := request(t, h, "GET", "/api/v1/features/"+record.ID+"/evidence?revision="+revision+"&chunk="+j.Exports[0].Manifest.SourceReportSHA256, nil, nil)
		if foreign.Code != 404 {
			t.Fatal("foreign feature evidence exposed", foreign.Code)
		}
	}
	importFixture(t, a.Store, "features-new-head", time.Date(2026, 10, 7, 0, 0, 0, 0, time.UTC))
	if !bytes.Equal(request(t, h, "GET", path, nil, nil).Body.Bytes(), first.Body.Bytes()) {
		t.Fatal("frozen feature page drift")
	}
	backup := filepath.Join(t.TempDir(), "backup")
	if _, err = a.Store.Backup(context.Background(), backup); err != nil {
		t.Fatal(err)
	}
	if _, err = store.VerifyBackup(context.Background(), backup); err != nil {
		t.Fatal(err)
	}
	rebuilt := filepath.Join(t.TempDir(), "rebuilt")
	if err = store.Rebuild(backup, rebuilt, "fixture"); err != nil {
		t.Fatal(err)
	}
	recovered, err := store.Open(rebuilt, "fixture")
	if err != nil {
		t.Fatal(err)
	}
	defer recovered.Close()
	original := a.Store
	a.Store = recovered
	defer func() { a.Store = original }()
	if got := request(t, h, "GET", path+"&cursor="+url.QueryEscape(page.Next), nil, nil); got.Code != 200 || !bytes.Equal(got.Body.Bytes(), next.Body.Bytes()) {
		t.Fatal("rebuild lost frozen feature cursor", got.Code, got.Body.String())
	}
	selectedRows, err := recovered.FeatureProbePage(context.Background(), revision, j.Exports[0].Manifest.ReportID, 0, 10)
	if err != nil || selectedRows.Total != 2 {
		t.Fatal("rebuild lost report feature index", err)
	}
	rows, err := recovered.CatalogPage(context.Background(), revision, "feature-probe", 0, 10)
	if err != nil || len(rows.Items) != 2 {
		t.Fatal("recovery lost feature probes", err)
	}
	for _, record := range rows.Items {
		probe, _ := wire.FeatureProbeData(record.Data)
		body, e := recovered.FeatureEvidenceContext(context.Background(), revision, record.ID, probe.Evidence[0])
		if e != nil || !bytes.Equal(body, objects[probe.Evidence[0]]) {
			t.Fatal("recovered feature evidence drift", e)
		}
	}
}
