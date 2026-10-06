package store

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func TestBinaryAdmissionPublicationRecoveryAndHistory(t *testing.T) {
	dir := t.TempDir()
	root := filepath.Join(dir, "live")
	s := openTest(t, root)
	defer func() {
		if s != nil {
			s.Close()
		}
	}()
	date := time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC)
	old := publishTest(t, s, "binary-capture", date)
	data := bytes.Repeat([]byte{0x90, 0xc3}, 200000)
	job, objects, artifact, err := testutil.BinaryFixture("binary-capture", date, data)
	if err != nil {
		t.Fatal(err)
	}
	job.Attempt = "binary-representation"
	id, err := s.Submit(job)
	if err != nil {
		t.Fatal(err)
	}
	for hash, b := range objects {
		if err = s.InstallDeclared(hash, bytes.NewReader(b)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = s.content(wire.Hash(data)); err == nil {
		t.Fatal("binary bypassed JSON decoded ceiling")
	}
	revision, err := s.Commit(id)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := s.Results(Query{Revision: revision}, true)
	if err != nil || len(rows) != 3 {
		t.Fatal("adding bytes created another measurement", len(rows), err)
	}
	_, got, err := s.ArtifactBytes(context.Background(), revision, artifact)
	if err != nil || !bytes.Equal(got, data) {
		t.Fatal("original bytes changed", err)
	}
	if _, _, err = s.ArtifactBytes(context.Background(), old, artifact); !errors.Is(err, ErrNotFound) {
		t.Fatal("binary leaked into older revision", err)
	}
	backup := filepath.Join(dir, "backup")
	if _, err = s.Backup(context.Background(), backup); err != nil {
		t.Fatal(err)
	}
	if _, err = VerifyBackup(context.Background(), backup); err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"restore", "rebuild"} {
		dest := filepath.Join(dir, mode)
		if mode == "restore" {
			err = Restore(context.Background(), backup, dest, "fixture")
		} else {
			err = Rebuild(backup, dest, "fixture")
		}
		if err != nil {
			t.Fatal(mode, err)
		}
		recovered := openTest(t, dest)
		_, got, err = recovered.ArtifactBytes(context.Background(), revision, artifact)
		recovered.Close()
		if err != nil || !bytes.Equal(got, data) {
			t.Fatal(mode, "lost original", err)
		}
	}
	s.Close()
	s = openTest(t, root)
	if _, _, err = s.ArtifactBytes(context.Background(), revision, artifact); err != nil {
		t.Fatal("restart lost binary", err)
	}
	// Mutation is detected before any selected bytes can be served.
	if err = os.WriteFile(filepath.Join(root, "objects", wire.Hash(data)), bytes.Repeat([]byte{1}, len(data)), 0600); err != nil {
		t.Fatal(err)
	}
	if _, _, err = s.ArtifactBytes(context.Background(), revision, artifact); err == nil {
		t.Fatal("served corrupt native image")
	}
}

func TestEmptyBinaryIsAvailableContent(t *testing.T) {
	job, objects, artifact, err := testutil.BinaryFixture("empty-image", time.Now().UTC(), []byte{})
	if err != nil {
		t.Fatal(err)
	}
	s := openTest(t, t.TempDir())
	defer s.Close()
	id, err := s.Submit(job)
	if err != nil {
		t.Fatal(err)
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
	descriptor, data, err := s.ArtifactBytes(context.Background(), revision, artifact)
	if err != nil || descriptor.Content.Status != "available" || len(data) != 0 {
		t.Fatal("empty bytes became missing content", err)
	}
}

func TestBinaryQuarantineAndGraceDeletion(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	defer s.Close()
	data := bytes.Repeat([]byte{0x90}, 400000)
	digest := wire.Hash(data)
	if err := s.InstallBinary(digest, bytes.NewReader(data)); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	aged := now.Add(-48 * time.Hour)
	if err := os.Chtimes(filepath.Join(root, "objects", digest), aged, aged); err != nil {
		t.Fatal(err)
	}
	options := GCOptions{Apply: true, Now: now, Grace: time.Hour, QuarantineGrace: time.Hour}
	report, err := s.GC(context.Background(), options)
	if err != nil || report.Quarantined != 1 {
		t.Fatal("large binary was not quarantined", report, err)
	}
	options.Now = now.Add(2 * time.Hour)
	report, err = s.GC(context.Background(), options)
	if err != nil || report.Deleted != 1 || report.BytesFreed != int64(len(data)) {
		t.Fatal("binary grace deletion failed", report, err)
	}
}
