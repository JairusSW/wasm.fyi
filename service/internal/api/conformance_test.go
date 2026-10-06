package api

import (
	"bytes"
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func TestConformanceImportSourceHTTPAndRebuild(t *testing.T) {
	a, h := telemetryAPI(t, nil)
	// Exercise the production constructor, including its bounded result cache.
	h, err := New(a.Store, a.Token, a.CursorKey)
	if err != nil {
		t.Fatal(err)
	}
	job, objects, err := testutil.ConformanceFixture("official-independent")
	if err != nil {
		t.Fatal(err)
	}
	id, err := a.Store.Submit(job)
	if err != nil {
		t.Fatal(err)
	}
	for hash, body := range objects {
		if err = a.Store.InstallDeclared(hash, bytes.NewReader(body)); err != nil {
			t.Fatal(err)
		}
	}
	revision, err := a.Store.Commit(id)
	if err != nil {
		t.Fatal(err)
	}
	page := request(t, h, "GET", "/api/v1/conformance?revision="+revision, nil, nil)
	var catalog struct {
		Items []wire.Record `json:"items"`
		Total int           `json:"total"`
	}
	if page.Code != 200 || json.Unmarshal(page.Body.Bytes(), &catalog) != nil || catalog.Total != 1 {
		t.Fatal(page.Code, page.Body.String())
	}
	lane, err := wire.ConformanceLaneData(catalog.Items[0].Data)
	if err != nil {
		t.Fatal(err)
	}
	if lane.Totals["failed"] != 1 || lane.Totals["skipped"] != 3 {
		t.Fatal("conformance count drift")
	}
	results := request(t, h, "GET", "/api/v1/results?revision="+revision, nil, nil)
	if results.Code != 200 || !bytes.Contains(results.Body.Bytes(), []byte(`"total":0`)) {
		t.Fatal("conformance manufactured measurements", results.Code, results.Body.String())
	}
	sourcePage := request(t, h, "GET", "/api/v1/conformance/sources/"+lane.SourceID+"?revision="+revision, nil, nil)
	var detail struct {
		Record wire.Record `json:"record"`
	}
	if sourcePage.Code != 200 || json.Unmarshal(sourcePage.Body.Bytes(), &detail) != nil {
		t.Fatal(sourcePage.Code, sourcePage.Body.String())
	}
	source, err := wire.ConformanceSourceData(detail.Record.Data)
	if err != nil {
		t.Fatal(err)
	}
	for _, chunk := range append(source.Chunks, source.Receipt) {
		path := "/api/v1/conformance/sources/" + lane.SourceID + "/chunks?revision=" + revision + "&chunk=" + chunk.SHA256
		got := request(t, h, "GET", path, nil, nil)
		if got.Code != 200 || !bytes.Equal(got.Body.Bytes(), objects[chunk.SHA256]) {
			t.Fatal("conformance original source drift", got.Code)
		}
	}
	foreign := request(t, h, "GET", "/api/v1/conformance/sources/"+lane.SourceID+"/chunks?revision="+revision+"&chunk="+job.Plan, nil, nil)
	if foreign.Code != 404 {
		t.Fatal("unrelated source exposed", foreign.Code)
	}
	second, payloads, err := testutil.ConformanceFixture("different-source")
	if err != nil {
		t.Fatal(err)
	}
	secondID, err := a.Store.Submit(second)
	if err != nil {
		t.Fatal(err)
	}
	for hash, body := range payloads {
		if err = a.Store.InstallDeclared(hash, bytes.NewReader(body)); err != nil {
			t.Fatal(err)
		}
	}
	latest, err := a.Store.Commit(secondID)
	if err != nil {
		t.Fatal(err)
	}
	global := request(t, h, "GET", "/api/v1/conformance?revision="+latest+"&limit=1", nil, nil)
	var first struct {
		Total int    `json:"total"`
		Next  string `json:"nextCursor"`
	}
	if global.Code != 200 || json.Unmarshal(global.Body.Bytes(), &first) != nil || first.Total != 2 || first.Next == "" {
		t.Fatal("global page differs", global.Body.String())
	}
	scoped := request(t, h, "GET", "/api/v1/conformance?revision="+latest+"&source="+lane.SourceID+"&limit=1", nil, nil)
	if scoped.Code != 200 || json.Unmarshal(scoped.Body.Bytes(), &first) != nil || first.Total != 1 || first.Next != "" {
		t.Fatal("source filtering occurred after pagination", scoped.Body.String())
	}
	var cursor struct {
		Next string `json:"nextCursor"`
	}
	json.Unmarshal(global.Body.Bytes(), &cursor)
	crossed := request(t, h, "GET", "/api/v1/conformance?revision="+latest+"&source="+lane.SourceID+"&limit=1&cursor="+cursor.Next, nil, nil)
	if crossed.Code != 400 {
		t.Fatal("cursor crossed source scope", crossed.Code)
	}
	for path, kind := range map[string]string{"conformance-contexts": "conformance-context", "conformance-coverage": "conformance-coverage"} {
		got := request(t, h, "GET", "/api/v1/"+path+"?revision="+latest+"&source="+lane.SourceID, nil, nil)
		var page struct {
			Items []wire.Record `json:"items"`
			Total int           `json:"total"`
		}
		if got.Code != 200 || json.Unmarshal(got.Body.Bytes(), &page) != nil || page.Total != 1 || page.Items[0].Kind != kind {
			t.Fatal("source metadata population drift", got.Code, got.Body.String())
		}
		if kind == "conformance-coverage" {
			coverage, err := wire.ConformanceCoverageData(page.Items[0].Data)
			if err != nil || coverage.Status != "uncollected" {
				t.Fatal("uncollected became a suite outcome", err)
			}
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
	if err = store.Rebuild(backup, rebuilt, "fixture"); err != nil {
		t.Fatal(err)
	}
	recovered, err := store.Open(rebuilt, "fixture")
	if err != nil {
		t.Fatal(err)
	}
	defer recovered.Close()
	record, err := recovered.Record(revision, "conformance", catalog.Items[0].ID)
	if err != nil || !bytes.Equal(record.Data, catalog.Items[0].Data) {
		t.Fatal("conformance reconstruction drift", err)
	}
	for _, kind := range []string{"conformance-context", "conformance-coverage"} {
		page, err := recovered.ConformancePage(context.Background(), revision, kind, lane.SourceID, 0, 10)
		if err != nil || page.Total != 1 {
			t.Fatal("reconstruction lost context/coverage", kind, err)
		}
	}
	for _, chunk := range source.Chunks {
		body, err := recovered.ConformanceSourceChunk(context.Background(), revision, lane.SourceID, chunk.SHA256)
		if err != nil || !bytes.Equal(body, objects[chunk.SHA256]) {
			t.Fatal("reconstruction lost original conformance bytes", err)
		}
	}
}

func TestConformanceCannotPublishMeasurementRecords(t *testing.T) {
	a, _ := telemetryAPI(t, nil)
	job, objects, err := testutil.ConformanceFixture("injection")
	if err != nil {
		t.Fatal(err)
	}
	data := []byte(`{"id":"synthetic metric"}`)
	body, err := wire.Encode(wire.Record{Kind: "metric", ID: wire.Hash(data), Data: data})
	if err != nil {
		t.Fatal(err)
	}
	hash := wire.Hash(body)
	objects[hash] = body
	job.Exports[0].Manifest.Objects = append(job.Exports[0].Manifest.Objects, wire.Object{SHA256: hash, Bytes: len(body), Kind: "record"})
	manifest, _ := wire.Encode(job.Exports[0].Manifest)
	job.Exports[0].SHA256 = wire.Hash(manifest)
	id, err := a.Store.Submit(job)
	if err != nil {
		t.Fatal(err)
	}
	for digest, payload := range objects {
		if err = a.Store.InstallDeclared(digest, bytes.NewReader(payload)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = a.Store.Commit(id); err == nil {
		t.Fatal("conformance introduced a measurement record")
	}
	if a.Store.Current() != "" {
		t.Fatal("rejected conformance import became public")
	}
}

func TestConformanceRejectsIncompleteOrForeignCoverage(t *testing.T) {
	for _, name := range []string{"count", "source", "time", "outcome"} {
		t.Run(name, func(t *testing.T) {
			a, _ := telemetryAPI(t, nil)
			job, objects, err := testutil.ConformanceFixture("coverage-" + name)
			if err != nil {
				t.Fatal(err)
			}
			for i, object := range job.Exports[0].Manifest.Objects {
				if object.Kind != "record" {
					continue
				}
				var record wire.Record
				if err = wire.Decode(objects[object.SHA256], &record); err != nil {
					t.Fatal(err)
				}
				wanted := "conformance-coverage"
				if name == "count" {
					wanted = "conformance-context"
				}
				if record.Kind != wanted {
					continue
				}
				var data map[string]any
				json.Unmarshal(record.Data, &data)
				switch name {
				case "count":
					data["coverageCount"] = 2
				case "source":
					data["sourceId"] = wire.Hash([]byte("foreign"))
				case "time":
					data["created"] = "2026-10-07T00:00:00Z"
				case "outcome":
					data["status"] = "passed"
				}
				record.Data, _ = wire.Encode(data)
				record.ID = wire.Hash(record.Data)
				body, _ := wire.Encode(record)
				hash := wire.Hash(body)
				delete(objects, object.SHA256)
				objects[hash] = body
				job.Exports[0].Manifest.Objects[i] = wire.Object{SHA256: hash, Bytes: len(body), Kind: "record"}
			}
			manifest, _ := wire.Encode(job.Exports[0].Manifest)
			job.Exports[0].SHA256 = wire.Hash(manifest)
			id, err := a.Store.Submit(job)
			if err != nil {
				t.Fatal(err)
			}
			for hash, body := range objects {
				if err = a.Store.InstallDeclared(hash, bytes.NewReader(body)); err != nil {
					t.Fatal(err)
				}
			}
			if _, err = a.Store.Commit(id); err == nil {
				t.Fatal("invalid coverage became public")
			}
			expected := map[string]string{"count": "population differs", "source": "coverage context", "time": "coverage context", "outcome": "invalid conformance coverage"}[name]
			if !strings.Contains(err.Error(), expected) {
				t.Fatal("wrong rejection boundary", name, err)
			}
			if a.Store.Current() != "" {
				t.Fatal("partial conformance revision exposed")
			}
		})
	}
}

func TestLegacyConformanceExportsRetainUnknownMetadata(t *testing.T) {
	a, _ := telemetryAPI(t, nil)
	job, objects, err := testutil.ConformanceFixture("legacy")
	if err != nil {
		t.Fatal(err)
	}
	kept := []wire.Object{}
	for _, object := range job.Exports[0].Manifest.Objects {
		if object.Kind == "record" {
			var record wire.Record
			if err = wire.Decode(objects[object.SHA256], &record); err != nil {
				t.Fatal(err)
			}
			if record.Kind == "conformance-context" || record.Kind == "conformance-coverage" {
				delete(objects, object.SHA256)
				continue
			}
		}
		kept = append(kept, object)
	}
	job.Exports[0].Manifest.Objects = kept
	manifest, _ := wire.Encode(job.Exports[0].Manifest)
	job.Exports[0].SHA256 = wire.Hash(manifest)
	id, err := a.Store.Submit(job)
	if err != nil {
		t.Fatal(err)
	}
	for hash, body := range objects {
		if err = a.Store.InstallDeclared(hash, bytes.NewReader(body)); err != nil {
			t.Fatal(err)
		}
	}
	revision, err := a.Store.Commit(id)
	if err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"conformance-context", "conformance-coverage"} {
		page, err := a.Store.CatalogPage(context.Background(), revision, kind, 0, 100)
		if err != nil || page.Total != 0 {
			t.Fatal("legacy archive received invented metadata", kind, err)
		}
	}
	backup := filepath.Join(t.TempDir(), "backup")
	if _, err = a.Store.Backup(context.Background(), backup); err != nil {
		t.Fatal(err)
	}
	if _, err = store.VerifyBackup(context.Background(), backup); err != nil {
		t.Fatal(err)
	}
}
