package api

import (
	"bytes"
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

// A selected trial must remain reachable when its siblings collectively exceed
// the authorization scan byte budget. Paging must not preload those siblings.
func TestEvidenceIndexSelectedTrialAndPortableReads(t *testing.T) {
	job, objects, err := testutil.Fixture("indexed-trials", time.Date(2026, 10, 6, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	manifest := &job.Exports[0].Manifest
	add := func(value any) string {
		b, err := wire.Encode(value)
		if err != nil {
			t.Fatal(err)
		}
		id := wire.Hash(b)
		objects[id] = b
		manifest.Objects = append(manifest.Objects, wire.Object{SHA256: id, Bytes: len(b), Kind: "evidence"})
		return id
	}
	refs := []string{}
	for i := 0; i < 512; i++ {
		refs = append(refs, add(map[string]any{"kind": "trial", "trialId": i, "log": strings.Repeat("x", 100000)}))
	}
	pages := []string{}
	for i := 0; i < len(refs); i += wire.EvidenceIndexReferences {
		pages = append(pages, add(wire.EvidenceIndex{Kind: "evidence-index", Schema: 1, References: refs[i : i+wire.EvidenceIndexReferences]}))
	}
	root := add(wire.EvidenceIndex{Kind: "evidence-index", Schema: 1, References: pages})
	resultID := ""
	var expectedSummary json.RawMessage
	for i, object := range manifest.Objects {
		if object.Kind != "record" {
			continue
		}
		var record wire.Record
		if err = wire.Decode(objects[object.SHA256], &record); err != nil {
			t.Fatal(err)
		}
		if record.Kind != "result" || resultID != "" {
			continue
		}
		var result wire.Result
		if err = wire.Decode(record.Data, &result); err != nil {
			t.Fatal(err)
		}
		expectedSummary = append(json.RawMessage{}, result.Summary...)
		result.Evidence = []string{root}
		record.Data, _ = wire.Encode(result)
		record.ID = wire.Hash(record.Data)
		resultID = record.ID
		b, _ := wire.Encode(record)
		delete(objects, object.SHA256)
		objects[wire.Hash(b)] = b
		manifest.Objects[i] = wire.Object{SHA256: wire.Hash(b), Bytes: len(b), Kind: "record"}
	}
	if resultID == "" {
		t.Fatal("missing fixture result")
	}
	payload := manifest.Objects
	manifest.Objects = []wire.Object{}
	for start := 0; start < len(payload); start += wire.MaxObjects {
		page := wire.InventoryPage{Schema: 1, Objects: payload[start:min(start+wire.MaxObjects, len(payload))]}
		b, _ := wire.Encode(page)
		descriptor := wire.Inventory{SHA256: wire.Hash(b), Bytes: len(b), Objects: len(page.Objects)}
		for _, object := range page.Objects {
			descriptor.ContentBytes += int64(object.Bytes)
		}
		objects[descriptor.SHA256] = b
		manifest.InventoryPages = append(manifest.InventoryPages, descriptor)
	}
	b, _ := wire.Encode(manifest)
	job.Exports[0].SHA256 = wire.Hash(b)
	dir := t.TempDir()
	live := filepath.Join(dir, "live")
	s, err := store.Open(live, "fixture")
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if s != nil {
			s.Close()
		}
	}()
	id, err := s.Submit(job)
	if err != nil {
		t.Fatal(err)
	}
	for _, page := range manifest.InventoryPages {
		if err = s.InstallDeclared(page.SHA256, bytes.NewReader(objects[page.SHA256])); err != nil {
			t.Fatal(err)
		}
		if err = s.AttachInventory(id, page.SHA256); err != nil {
			t.Fatal(err)
		}
	}
	for hash, b := range objects {
		if err = s.InstallDeclared(hash, bytes.NewReader(b)); err != nil {
			t.Fatal(err)
		}
	}
	revision, err := s.Commit(id)
	if err != nil {
		t.Fatal(err)
	}
	check := func(s *store.Store) {
		t.Helper()
		h, err := New(s, strings.Repeat("x", 32), bytes.Repeat([]byte{1}, 32))
		if err != nil {
			t.Fatal(err)
		}
		base := "/api/v1/results/" + resultID + "/samples?revision=" + revision
		w := request(t, h, "GET", base, nil, nil)
		if w.Code != 200 || w.Body.Len() > 1024 {
			t.Fatal("result preloads inventory", w.Code, w.Body.Len())
		}
		for _, hash := range []string{root, pages[0], refs[0], refs[len(refs)-1]} {
			w = request(t, h, "GET", base+"&chunk="+hash, nil, nil)
			if w.Code != 200 || !bytes.Equal(bytes.TrimSpace(w.Body.Bytes()), objects[hash]) {
				t.Fatal("selected index/trial failed", hash, w.Code, w.Body.Len())
			}
		}
		rows, err := s.Results(store.Query{Revision: revision}, false)
		if err != nil {
			t.Fatal(err)
		}
		for _, row := range rows {
			if row.ID == resultID {
				var result wire.Result
				_ = wire.Decode(row.Data, &result)
				if !bytes.Equal(result.Summary, expectedSummary) {
					t.Fatal("summary drift")
				}
			}
		}
	}
	check(s)
	backup := filepath.Join(dir, "backup")
	if _, err = s.Backup(context.Background(), backup); err != nil {
		t.Fatal(err)
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s = nil
	s, err = store.Open(live, "fixture")
	if err != nil {
		t.Fatal(err)
	}
	check(s)
	rebuilt := filepath.Join(dir, "rebuilt")
	if err = store.Rebuild(backup, rebuilt, "fixture"); err != nil {
		t.Fatal(err)
	}
	recovered, err := store.Open(rebuilt, "fixture")
	if err != nil {
		t.Fatal(err)
	}
	defer recovered.Close()
	check(recovered)
}
