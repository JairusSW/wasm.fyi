package store

import (
	"bytes"
	"context"
	"fmt"
	"path/filepath"
	"sort"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func TestObservationBatchPreservesSequentialRootsWithBoundedWrites(t *testing.T) {
	cells := []testutil.CohortCell{}
	for i := 0; i < observationBatchRecords+1; i++ {
		cells = append(cells, testutil.CohortCell{Runtime: "a", Workload: fmt.Sprintf("fixture/%03d", i), Value: float64(i + 1)})
	}
	job, objects, err := testutil.CohortFixture("observation-batch", time.Date(2026, 10, 6, 0, 0, 0, 0, time.UTC), cells)
	if err != nil {
		t.Fatal(err)
	}
	manifest := &job.Exports[0].Manifest
	payload := manifest.Objects
	manifest.Objects = []wire.Object{}
	for start := 0; start < len(payload); start += wire.MaxObjects {
		page := wire.InventoryPage{Schema: 1, Objects: payload[start:min(start+wire.MaxObjects, len(payload))]}
		data, err := wire.Encode(page)
		if err != nil {
			t.Fatal(err)
		}
		descriptor := wire.Inventory{SHA256: wire.Hash(data), Bytes: len(data), Objects: len(page.Objects)}
		for _, object := range page.Objects {
			descriptor.ContentBytes += int64(object.Bytes)
		}
		objects[descriptor.SHA256] = data
		manifest.InventoryPages = append(manifest.InventoryPages, descriptor)
	}
	encoded, err := wire.Encode(manifest)
	if err != nil {
		t.Fatal(err)
	}
	job.Exports[0].SHA256 = wire.Hash(encoded)
	build := func(root string) (*Store, Revision, []wire.Record) {
		s := openTest(t, root)
		catalog := map[string]string{}
		records := []wire.Record{}
		for hash, b := range objects {
			if err = s.Install(hash, bytes.NewReader(b)); err != nil {
				t.Fatal(err)
			}
			var r wire.Record
			if wire.Decode(b, &r) == nil && r.ID != "" {
				catalog[r.Kind+":"+r.ID] = hash
				if r.Kind == "result" {
					records = append(records, r)
				}
			}
		}
		rev := Revision{ObservationPolicy: ObservationPolicy}
		rev.Catalog, err = s.mapSetMany(context.Background(), "", catalog, 0)
		if err != nil {
			t.Fatal(err)
		}
		sort.Slice(records, func(i, j int) bool { return records[i].ID < records[j].ID })
		return s, rev, records
	}
	serial, old, records := build(filepath.Join(t.TempDir(), "serial"))
	defer serial.Close()
	batch, next, _ := build(filepath.Join(t.TempDir(), "batch"))
	defer batch.Close()
	serialWrites, batchWrites := 0, 0
	serial.fail = func(stage string) error {
		if stage == "content-installed" {
			serialWrites++
		}
		return nil
	}
	batch.fail = func(stage string) error {
		if stage == "content-installed" {
			batchWrites++
		}
		return nil
	}
	updates := &observationBatch{observations: map[string]string{}, sources: map[string]string{}}
	for _, r := range records {
		a, err := serial.registerObservation(&old, r)
		if err != nil {
			t.Fatal(err)
		}
		b, err := batch.registerObservation(&next, r, updates)
		if err != nil || a != b {
			t.Fatal("capture semantics changed", a, b, err)
		}
		first, err := serial.resolveObservation(old, r.ID)
		if err != nil {
			t.Fatal(err)
		}
		second, err := batch.resolveObservation(next, r.ID, updates)
		if err != nil || first != second {
			t.Fatal("within-batch lookup differs", first, second, err)
		}
	}
	if batchWrites != 0 {
		t.Fatal("intermediate observation nodes installed", batchWrites)
	}
	if err = updates.flush(context.Background(), batch, &next); err != nil {
		t.Fatal(err)
	}
	if old.Observations != next.Observations || old.SourceBindings != next.SourceBindings {
		t.Fatal("canonical final map changed")
	}
	if batchWrites >= serialWrites/4 {
		t.Fatal("observation write amplification remains", serialWrites, batchWrites)
	}
	t.Logf("observation index installations: serial=%d batch=%d results=%d", serialWrites, batchWrites, len(records))
	// Publication must still retain exact rows and current/previous selections.
	real := openTest(t, filepath.Join(t.TempDir(), "publication"))
	defer real.Close()
	for id, b := range objects {
		if err = real.Install(id, bytes.NewReader(b)); err != nil {
			t.Fatal(err)
		}
	}
	receipt, err := real.Submit(job)
	if err != nil {
		t.Fatal(err)
	}
	for _, page := range manifest.InventoryPages {
		if err := real.AttachInventory(receipt, page.SHA256); err != nil {
			t.Fatal(err)
		}
	}
	revision, err := real.Commit(receipt)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := real.Results(Query{Revision: revision}, true)
	if err != nil || len(rows) != len(records) {
		t.Fatal("publication rows", len(rows), err)
	}
	want := map[string][]byte{}
	for _, r := range records {
		want[r.ID] = r.Data
	}
	for _, r := range rows {
		stored, err := real.Record(revision, "result", r.ID)
		if err != nil || !bytes.Equal(stored.Data, want[r.ID]) {
			t.Fatal("canonical scientific record drift", r.ID, err)
		}
		var projected wire.Result
		if err := wire.Decode(want[r.ID], &projected); err != nil {
			t.Fatal(err)
		}
		// Query summaries intentionally omit evidence references.
		projected.Evidence = nil
		expected, err := wire.Encode(projected)
		if err != nil || !bytes.Equal(r.Data, expected) {
			t.Fatal("summary scientific record drift", r.ID, err)
		}
	}
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	prior := next
	if err = updates.flush(canceled, batch, &next); err == nil || next.Observations != prior.Observations || next.SourceBindings != prior.SourceBindings {
		t.Fatal("cancellation mutated map roots")
	}
}
