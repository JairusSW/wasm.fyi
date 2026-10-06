package store

import (
	"bytes"
	"context"
	"fmt"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLargeCompletedJobPublicationAndPortableReads(t *testing.T) {
	date := time.Date(2026, 10, 6, 0, 0, 0, 0, time.UTC)
	var job wire.Job
	objects := map[string][]byte{}
	for report := 0; report < 8; report++ {
		part, payload, err := testutil.Fixture(fmt.Sprintf("large-job-%d", report), date)
		if err != nil {
			t.Fatal(err)
		}
		if report == 0 {
			job = part
			job.Exports = nil
		}
		manifest := part.Exports[0].Manifest
		for ordinal := len(manifest.Objects); ordinal < wire.MaxObjects; ordinal++ {
			b, _ := wire.Encode(map[string]any{"kind": "diagnostic", "report": report, "ordinal": ordinal})
			hash := wire.Hash(b)
			payload[hash] = b
			manifest.Objects = append(manifest.Objects, wire.Object{SHA256: hash, Bytes: len(b), Kind: "evidence"})
		}
		raw, _ := wire.Encode(manifest)
		job.Exports = append(job.Exports, wire.Export{SHA256: wire.Hash(raw), Manifest: manifest})
		for hash, b := range payload {
			objects[hash] = b
		}
	}
	raw, err := wire.Encode(job)
	if err != nil || len(raw) <= wire.ChunkBytes || len(raw) > wire.JobBytes {
		t.Fatal("fixture did not cross durable job boundary", len(raw), err)
	}
	dir := t.TempDir()
	root := filepath.Join(dir, "live")
	s := openTest(t, root)
	id, err := s.Submit(job)
	if err != nil {
		t.Fatal("valid bounded completed job rejected", err)
	}
	for hash, b := range objects {
		if err = s.InstallDeclared(hash, bytes.NewReader(b)); err != nil {
			t.Fatal(err)
		}
	}
	revision, err := s.Commit(id)
	if err != nil {
		t.Fatal("admitted job failed durable publication", err)
	}
	check := func(s *Store) {
		t.Helper()
		stored, err := s.PublishedArchive(context.Background(), revision, id)
		if err != nil || len(stored.Exports) != 8 {
			t.Fatal("large published job unreadable", err)
		}
		rows, err := s.Results(Query{Revision: revision}, true)
		if err != nil || len(rows) != 24 {
			t.Fatal("large job measurements drifted", len(rows), err)
		}
	}
	check(s)
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s = openTest(t, root)
	defer s.Close()
	check(s)
	backup := filepath.Join(dir, "backup")
	if _, err = s.Backup(context.Background(), backup); err != nil {
		t.Fatal(err)
	}
	rebuilt := filepath.Join(dir, "rebuilt")
	if err = Rebuild(backup, rebuilt, "fixture"); err != nil {
		t.Fatal(err)
	}
	r := openTest(t, rebuilt)
	defer r.Close()
	check(r)
	t.Logf("published and rebuilt %d-byte completed job", len(raw))
}

func TestOversizedJobRejectedBeforeAdmission(t *testing.T) {
	job, _, err := testutil.Fixture("oversized-job", time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	job.Exports[0].Manifest.Exporter = strings.Repeat("producer", wire.JobBytes/8+1)
	raw, _ := wire.Encode(job.Exports[0].Manifest)
	job.Exports[0].SHA256 = wire.Hash(raw)
	s := openTest(t, t.TempDir())
	defer s.Close()
	if _, err = s.Submit(job); err == nil {
		t.Fatal("oversized job admitted")
	}
	quota, err := s.quota()
	if err != nil || quota.Jobs != 0 || quota.Bytes != 0 || s.Current() != "" {
		t.Fatal("rejected job changed admission or publication", quota, err)
	}
}
