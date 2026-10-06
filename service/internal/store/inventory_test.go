package store

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func pagedFixture(t *testing.T, seed string) (wire.Job, map[string][]byte) {
	t.Helper()
	job, objects, err := testutil.Fixture(seed, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	manifest := &job.Exports[0].Manifest
	for i := 0; i < 600; i++ {
		b, _ := wire.Encode(map[string]any{"kind": "diagnostic", "ordinal": i})
		digest := wire.Hash(b)
		objects[digest] = b
		manifest.Objects = append(manifest.Objects, wire.Object{SHA256: digest, Bytes: len(b), Kind: "evidence"})
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
	return job, objects
}

func TestPagedInventoryAdmissionRecoveryAndPublication(t *testing.T) {
	job, objects := pagedFixture(t, "paged-recovery")
	dir := t.TempDir()
	root := filepath.Join(dir, "live")
	s := openTest(t, root)
	defer func() {
		if s != nil {
			s.Close()
		}
	}()
	id, err := s.Submit(job)
	if err != nil {
		t.Fatal(err)
	}
	pages := job.Exports[0].Manifest.InventoryPages
	var first wire.InventoryPage
	_ = json.Unmarshal(objects[pages[0].SHA256], &first)
	leaf := first.Objects[0].SHA256
	if err = s.InstallDeclared(leaf, bytes.NewReader(objects[leaf])); !errors.Is(err, ErrUndeclared) {
		t.Fatal("granted leaf before inventory", err)
	}
	status, err := s.ImportStatus(id)
	if err != nil || status.MissingComplete || status.PendingInventories != len(pages) {
		t.Fatal("unexpanded inventory masqueraded as complete progress", status, err)
	}
	var expected int64
	for _, page := range pages {
		expected += int64(page.Bytes) + page.ContentBytes
	}
	quota, err := s.quota()
	if err != nil || quota.Bytes != expected || quota.Jobs != 1 {
		t.Fatal("did not reserve complete payload", quota, err)
	}
	if err = s.InstallDeclared(pages[0].SHA256, bytes.NewReader(objects[pages[0].SHA256])); err != nil {
		t.Fatal(err)
	}
	if err = s.InstallDeclared(leaf, bytes.NewReader(objects[leaf])); !errors.Is(err, ErrUndeclared) {
		t.Fatal("unverified page granted leaf", err)
	}
	if err = s.AttachInventory(id, pages[0].SHA256); err != nil {
		t.Fatal(err)
	}
	if err = s.AttachInventory(id, pages[0].SHA256); err != nil {
		t.Fatal("attachment not idempotent", err)
	}
	if err = s.InstallDeclared(leaf, bytes.NewReader(objects[leaf])); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Commit(id); err == nil || s.Current() != "" {
		t.Fatal("published incomplete inventory")
	}
	backup := filepath.Join(dir, "partial-backup")
	if _, err = s.Backup(context.Background(), backup); err != nil {
		t.Fatal(err)
	}
	restored := filepath.Join(dir, "restored")
	if err = Restore(context.Background(), backup, restored, "fixture"); err != nil {
		t.Fatal(err)
	}
	r := openTest(t, restored)
	if err = r.InstallDeclared(leaf, bytes.NewReader(objects[leaf])); err != nil {
		t.Fatal("restore lost grants", err)
	}
	r.Close()
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s = openTest(t, root)
	for _, page := range pages {
		if err = s.InstallDeclared(page.SHA256, bytes.NewReader(objects[page.SHA256])); err != nil {
			t.Fatal(err)
		}
		if err = s.AttachInventory(id, page.SHA256); err != nil {
			t.Fatal(err)
		}
	}
	status, err = s.ImportStatus(id)
	if err != nil || !status.MissingComplete || status.PendingInventories != 0 {
		t.Fatal("expanded progress incomplete", status, err)
	}
	for hash, body := range objects {
		if err = s.InstallDeclared(hash, bytes.NewReader(body)); err != nil {
			t.Fatal(err)
		}
	}
	revision, err := s.Commit(id)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := s.Results(Query{Revision: revision}, false)
	if err != nil || len(rows) != 3 {
		t.Fatal("paged import changed result coverage", err)
	}
	if err = s.InstallDeclared(leaf, bytes.NewReader(objects[leaf])); !errors.Is(err, ErrUndeclared) {
		t.Fatal("commit retained upload permission", err)
	}
	quota, err = s.quota()
	if err != nil || quota.Bytes != 0 || quota.Jobs != 0 {
		t.Fatal("commit leaked reservation", quota, err)
	}
	complete := filepath.Join(dir, "complete-backup")
	if _, err = s.Backup(context.Background(), complete); err != nil {
		t.Fatal(err)
	}
	rebuilt := filepath.Join(dir, "rebuilt")
	if err = Rebuild(complete, rebuilt, "fixture"); err != nil {
		t.Fatal(err)
	}
	r = openTest(t, rebuilt)
	defer r.Close()
	if r.Current() != revision {
		t.Fatal("rebuild changed revision")
	}
	if _, err = r.Submit(job); err != nil {
		t.Fatal("rebuild lost idempotency", err)
	}
}

func TestPagedInventorySharedGrantsAndAbort(t *testing.T) {
	job, objects := pagedFixture(t, "paged-shared")
	s := openTest(t, t.TempDir())
	defer s.Close()
	first, err := s.Submit(job)
	if err != nil {
		t.Fatal(err)
	}
	for _, page := range job.Exports[0].Manifest.InventoryPages {
		if err = s.InstallDeclared(page.SHA256, bytes.NewReader(objects[page.SHA256])); err != nil {
			t.Fatal(err)
		}
		if err = s.AttachInventory(first, page.SHA256); err != nil {
			t.Fatal(err)
		}
	}
	job.Attempt = "second-attempt"
	second, err := s.Submit(job)
	if err != nil {
		t.Fatal(err)
	}
	for _, descriptor := range job.Exports[0].Manifest.InventoryPages {
		if err = s.AttachInventory(second, descriptor.SHA256); err != nil {
			t.Fatal(err)
		}
	}
	var page wire.InventoryPage
	_ = json.Unmarshal(objects[job.Exports[0].Manifest.InventoryPages[0].SHA256], &page)
	leaf := page.Objects[0].SHA256
	if err = s.Abort(first); err != nil {
		t.Fatal(err)
	}
	if err = s.InstallDeclared(leaf, bytes.NewReader(objects[leaf])); err != nil {
		t.Fatal("abort removed another import's grant", err)
	}
	if err = s.Abort(second); err != nil {
		t.Fatal(err)
	}
	if err = s.InstallDeclared(leaf, bytes.NewReader(objects[leaf])); !errors.Is(err, ErrUndeclared) {
		t.Fatal("abort leaked leaf permission", err)
	}
	if err = s.AttachInventory(first, job.Exports[0].Manifest.InventoryPages[0].SHA256); !errors.Is(err, ErrConflict) {
		t.Fatal("aborted page expanded", err)
	}
	quota, err := s.quota()
	if err != nil || quota.Jobs != 0 || quota.Bytes != 0 {
		t.Fatal("abort leaked reservation", err)
	}
}

func TestPagedInventoryCommitmentsAndQuota(t *testing.T) {
	job, objects := pagedFixture(t, "paged-invalid")
	limits := DefaultLimits()
	limits.PendingBytes = 1
	s, err := OpenWithLimits(t.TempDir(), "fixture", limits)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Submit(job); !errors.Is(err, ErrQuota) {
		t.Fatal("quota ignored undeclared payload", err)
	}
	s.Close()
	s = openTest(t, t.TempDir())
	defer s.Close()
	job.Exports[0].Manifest.InventoryPages[0].ContentBytes--
	b, _ := wire.Encode(job.Exports[0].Manifest)
	job.Exports[0].SHA256 = wire.Hash(b)
	id, err := s.Submit(job)
	if err != nil {
		t.Fatal(err)
	}
	page := job.Exports[0].Manifest.InventoryPages[0]
	if err = s.InstallDeclared(page.SHA256, bytes.NewReader(objects[page.SHA256])); err != nil {
		t.Fatal(err)
	}
	if err = s.AttachInventory(id, page.SHA256); !errors.Is(err, wire.ErrInvalid) {
		t.Fatal("accepted wrong payload total", err)
	}
	if s.Current() != "" {
		t.Fatal("exposed invalid inventory")
	}
}

func TestInventoryExpansionFailureIsAtomic(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	legacy, _, err := testutil.Fixture("expansion-conflict", time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Submit(legacy); err != nil {
		t.Fatal(err)
	}
	job, objects := pagedFixture(t, "expansion-conflict")
	job.Attempt = "paged-conflict"
	old := job.Exports[0].Manifest.InventoryPages[0]
	var page wire.InventoryPage
	_ = json.Unmarshal(objects[old.SHA256], &page)
	// Grant a new object first, then encounter a conflicting active permit.
	fresh := page.Objects[len(page.Objects)-1]
	conflicting := legacy.Exports[0].Manifest.Objects[0]
	if conflicting.Kind == "record" {
		conflicting.Kind = "evidence"
	} else {
		conflicting.Kind = "record"
	}
	page.Objects = []wire.Object{fresh, conflicting}
	b, _ := wire.Encode(page)
	descriptor := wire.Inventory{SHA256: wire.Hash(b), Bytes: len(b), Objects: 2, ContentBytes: int64(fresh.Bytes + conflicting.Bytes)}
	objects[descriptor.SHA256] = b
	job.Exports[0].Manifest.InventoryPages = []wire.Inventory{descriptor}
	b, _ = wire.Encode(job.Exports[0].Manifest)
	job.Exports[0].SHA256 = wire.Hash(b)
	id, err := s.Submit(job)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.InstallDeclared(descriptor.SHA256, bytes.NewReader(objects[descriptor.SHA256])); err != nil {
		t.Fatal(err)
	}
	if err = s.AttachInventory(id, descriptor.SHA256); !errors.Is(err, ErrConflict) {
		t.Fatal("ignored conflicting payload identity", err)
	}
	if err = s.InstallDeclared(fresh.SHA256, bytes.NewReader(objects[fresh.SHA256])); !errors.Is(err, ErrUndeclared) {
		t.Fatal("partial page grants escaped failed batch", err)
	}
	if err = s.Abort(id); err != nil {
		t.Fatal(err)
	}
}

func TestAdmissionOwnerMigration(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	job, objects, err := testutil.Fixture("owner-migration", time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	id, err := s.Submit(job)
	if err != nil {
		t.Fatal(err)
	}
	// Simulate the previous accounting schema: existing permits, no owner index.
	batch := s.db.NewBatch()
	prefix := key("permit-owner")
	if err = batch.DeleteRange(prefix, append(append([]byte(nil), prefix...), 255), nil); err != nil {
		t.Fatal(err)
	}
	if err = batch.Delete(key("admission-ready-v3"), nil); err != nil {
		t.Fatal(err)
	}
	if err = batch.Commit(nil); err != nil {
		t.Fatal(err)
	}
	batch.Close()
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s = openTest(t, root)
	defer s.Close()
	for hash, body := range objects {
		if err = s.InstallDeclared(hash, bytes.NewReader(body)); err != nil {
			t.Fatal("migration lost permit", err)
		}
	}
	if err = s.Abort(id); err != nil {
		t.Fatal(err)
	}
	quota, err := s.quota()
	if err != nil || quota.Jobs != 0 || quota.Bytes != 0 {
		t.Fatal("migration leaked accounting", err)
	}
}
