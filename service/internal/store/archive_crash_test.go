package store

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func stageParentCrash(t *testing.T, s *Store) string {
	t.Helper()
	job, objects := parentArchiveFixture(t, "crash-parent", time.Date(2026, 10, 5, 1, 0, 0, 0, time.UTC))
	id, err := s.Submit(job)
	if err != nil {
		t.Fatal(err)
	}
	missing, err := s.Missing(id)
	if err != nil {
		t.Fatal(err)
	}
	for _, o := range missing {
		if err = s.InstallDeclared(o.SHA256, bytes.NewReader(objects[o.SHA256])); err != nil {
			t.Fatal(err)
		}
	}
	return id
}
func TestArchiveCrashHelper(t *testing.T) {
	stage := os.Getenv("WASMFYI_TEST_ARCHIVE_CRASH_STAGE")
	if stage == "" {
		return
	}
	s := openTest(t, os.Getenv("WASMFYI_TEST_ARCHIVE_CRASH_ROOT"))
	id := stageParentCrash(t, s)
	s.fail = func(point string) error {
		if point == stage {
			os.Exit(99)
		}
		return nil
	}
	if _, err := s.Commit(id); err != nil {
		t.Fatal(err)
	}
	t.Fatal("archive crash point was not reached")
}
func TestActualArchiveCrashPublicationAndRestore(t *testing.T) {
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for _, stage := range []string{"files", "indexes", "before-commit", "after-commit", "after-portable"} {
		t.Run(stage, func(t *testing.T) {
			dir := t.TempDir()
			root := filepath.Join(dir, "live")
			s := openTest(t, root)
			previous := publishTest(t, s, "before-parent", time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC))
			if err = s.Close(); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
			defer cancel()
			child := exec.CommandContext(ctx, binary, "-test.run=^TestArchiveCrashHelper$")
			child.Env = append(os.Environ(), "WASMFYI_TEST_ARCHIVE_CRASH_STAGE="+stage, "WASMFYI_TEST_ARCHIVE_CRASH_ROOT="+root)
			out, runErr := child.CombinedOutput()
			exit, ok := runErr.(*exec.ExitError)
			if !ok || exit.ExitCode() != 99 {
				t.Fatalf("archive crash point not reached: %v %s", runErr, out)
			}
			s = openTest(t, root)
			defer s.Close()
			job, objects := parentArchiveFixture(t, "crash-parent", time.Date(2026, 10, 5, 1, 0, 0, 0, time.UTC))
			id, err := s.Submit(job)
			if err != nil {
				t.Fatal(err)
			}
			committed := stage == "after-commit" || stage == "after-portable"
			if committed == (s.Current() == previous) {
				t.Fatal("archive exposed wrong commit boundary")
			}
			_, accessErr := s.PublishedArchive(ctx, s.Current(), id)
			if committed && accessErr != nil || !committed && !errors.Is(accessErr, ErrNotFound) {
				t.Fatal("archive visibility crossed commit boundary", accessErr)
			}
			if !committed {
				missingChunk := job.ParentArchive.Chunks[0]
				if err = os.Remove(filepath.Join(root, "objects", missingChunk.SHA256)); err != nil {
					t.Fatal(err)
				}
				if _, err = s.Commit(id); err == nil || s.Current() != previous {
					t.Fatal("missing archive content became public")
				}
				missing, err := s.Missing(id)
				if err != nil {
					t.Fatal(err)
				}
				found := false
				for _, o := range missing {
					if o.SHA256 == missingChunk.SHA256 {
						found = true
					}
				}
				if !found {
					t.Fatal("resume did not request missing original content")
				}
				if err = s.InstallDeclared(missingChunk.SHA256, bytes.NewReader(objects[missingChunk.SHA256])); err != nil {
					t.Fatal(err)
				}
			}
			current, err := s.Commit(id)
			if err != nil {
				t.Fatal(err)
			}
			rows, err := s.Results(Query{Revision: current}, true)
			if err != nil || len(rows) != 6 {
				t.Fatal("archive retry duplicated or lost measurements", len(rows), err)
			}
			assertArchive := func(s *Store) {
				t.Helper()
				p, reader, err := s.OpenArchive(ctx, current, id)
				if err != nil {
					t.Fatal(err)
				}
				full, err := io.ReadAll(reader)
				if err != nil || int64(len(full)) != p.Bytes {
					t.Fatal("recovered archive is incomplete", err)
				}
				if err = p.Verify(job, s.objectRepresentation); err != nil {
					t.Fatal(err)
				}
			}
			assertArchive(s)
			backup := filepath.Join(dir, "backup")
			if _, err = s.Backup(ctx, backup); err != nil {
				t.Fatal(err)
			}
			rebuilt := filepath.Join(dir, "rebuilt")
			if err = Rebuild(backup, rebuilt, "fixture"); err != nil {
				t.Fatal(err)
			}
			r := openTest(t, rebuilt)
			defer r.Close()
			assertArchive(r)
			if replay, err := r.Commit(id); err != nil || replay != current {
				t.Fatal("archive restore broke idempotent publication", err)
			}
		})
	}
}
