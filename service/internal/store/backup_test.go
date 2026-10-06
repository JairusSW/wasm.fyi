package store

import (
	"bytes"
	"context"
	"errors"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestBackupRestoreAndContentOnlyRebuild(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, filepath.Join(root, "live"))
	defer s.Close()
	date := time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC)
	first := publishTest(t, s, "first", date)
	current := publishTest(t, s, "second", date.Add(time.Hour))
	pending := stage(t, s, "pending", date.Add(2*time.Hour))
	orphan := []byte("unpublished object")
	if e := s.Install(wire.Hash(orphan), bytes.NewReader(orphan)); e != nil {
		t.Fatal(e)
	}
	backup := filepath.Join(root, "backup")
	manifest, e := s.Backup(context.Background(), backup)
	if e != nil {
		t.Fatal(e)
	}
	if manifest.Current != current || len(manifest.Files) == 0 {
		t.Fatal("incomplete backup manifest")
	}
	if _, e = VerifyBackup(context.Background(), backup); e != nil {
		t.Fatal(e)
	}
	if _, e = os.Stat(filepath.Join(backup, "objects", wire.Hash(orphan))); !os.IsNotExist(e) {
		t.Fatal("copied unreachable object")
	}
	restored := filepath.Join(root, "restored")
	if e = Restore(context.Background(), backup, restored, "restored-publisher"); e != nil {
		t.Fatal(e)
	}
	copy := openTest(t, restored)
	if copy.Current() != current {
		t.Fatal("restore lost pointer")
	}
	if _, e = copy.Job(pending); e != nil {
		t.Fatal("restore lost staged import")
	}
	if _, e = copy.Commit(pending); e != nil {
		t.Fatal("cannot resume staged delivery")
	}
	if e = copy.Close(); e != nil {
		t.Fatal(e)
	}
	rebuilt := filepath.Join(root, "rebuilt")
	if e = Rebuild(backup, rebuilt, "rebuild-publisher"); e != nil {
		t.Fatal(e)
	}
	rebuild := openTest(t, rebuilt)
	defer rebuild.Close()
	if rebuild.Current() != current {
		t.Fatal("rebuild lost pointer")
	}
	for _, revision := range []string{first, current} {
		rows, e := rebuild.Results(Query{Revision: revision}, false)
		if e != nil || len(rows) != 3 {
			t.Fatalf("rebuilt scope drift %d %v", len(rows), e)
		}
	}
	if e = Restore(context.Background(), backup, restored, "another"); e == nil {
		t.Fatal("overwrote existing destination")
	}
}
func TestBackupRejectsCorruptionAndUnlistedContent(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, filepath.Join(root, "live"))
	defer s.Close()
	current := publishTest(t, s, "first", time.Now().UTC())
	backup := filepath.Join(root, "backup")
	if _, e := s.Backup(context.Background(), backup); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(filepath.Join(backup, "extra"), []byte("unexpected"), 0600); e != nil {
		t.Fatal(e)
	}
	if _, e := VerifyBackup(context.Background(), backup); e == nil {
		t.Fatal("unlisted file accepted")
	}
	if e := os.Remove(filepath.Join(backup, "extra")); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(filepath.Join(backup, "objects", current), []byte("corrupt"), 0600); e != nil {
		t.Fatal(e)
	}
	if e := Restore(context.Background(), backup, filepath.Join(root, "bad-restore"), "test"); e == nil {
		t.Fatal("corrupt backup restored")
	}
	if _, e := os.Stat(filepath.Join(root, "bad-restore")); !os.IsNotExist(e) {
		t.Fatal("failed restore installed partial destination")
	}
}
func TestUnpublishedIndexesCannotEnterRebuild(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, filepath.Join(root, "live"))
	date := time.Now().UTC()
	first := publishTest(t, s, "first", date)
	id := stage(t, s, "unpublished", date.Add(time.Hour))
	s.fail = func(stage string) error {
		if stage == "before-commit" {
			return errors.New("crash")
		}
		return nil
	}
	if _, e := s.Commit(id); e == nil {
		t.Fatal("failure ignored")
	}
	if e := s.Close(); e != nil {
		t.Fatal(e)
	}
	if e := Rebuild(filepath.Join(root, "live"), filepath.Join(root, "rebuilt"), "test"); e != nil {
		t.Fatal(e)
	}
	copy := openTest(t, filepath.Join(root, "rebuilt"))
	defer copy.Close()
	if copy.Current() != first {
		t.Fatal("abandoned staging root published")
	}
	rows, e := copy.Results(Query{Revision: first}, true)
	if e != nil || len(rows) != 3 {
		t.Fatal("abandoned attempt entered history")
	}
}

func TestDirectoryInstallationCannotReplaceRacingDestination(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "staged")
	destination := filepath.Join(root, "existing")
	if e := os.Mkdir(source, 0700); e != nil {
		t.Fatal(e)
	}
	if e := os.Mkdir(destination, 0700); e != nil {
		t.Fatal(e)
	}
	before, _ := os.Stat(destination)
	if e := installDirectory(source, destination); e == nil {
		t.Fatal("replaced existing destination")
	}
	after, e := os.Stat(destination)
	if e != nil || !os.SameFile(before, after) {
		t.Fatal("changed existing directory")
	}
	if _, e = os.Stat(source); e != nil {
		t.Fatal("lost staged directory")
	}
}
