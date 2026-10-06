package store

import (
	"bytes"
	"context"
	"errors"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func stageDisassemblyCrash(t *testing.T, s *Store) (string, string, map[string][]byte) {
	t.Helper()
	job, objects, artifact, err := testutil.DisassemblyFixture("crash-disassembly", time.Date(2026, 10, 6, 1, 0, 0, 0, time.UTC), "header\n0: nop\n1: ret\n")
	if err != nil {
		t.Fatal(err)
	}
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
	return id, artifact, objects
}
func TestDisassemblyCrashHelper(t *testing.T) {
	checkpoint := os.Getenv("WASMFYI_DISASSEMBLY_CRASH_POINT")
	if checkpoint == "" {
		return
	}
	s := openTest(t, os.Getenv("WASMFYI_DISASSEMBLY_CRASH_ROOT"))
	id, _, _ := stageDisassemblyCrash(t, s)
	s.fail = func(point string) error {
		if point == checkpoint {
			os.Exit(99)
		}
		return nil
	}
	if _, err := s.Commit(id); err != nil {
		t.Fatal(err)
	}
	t.Fatal("crash point was not reached")
}
func TestActualDisassemblyCrashPublicationAndRebuild(t *testing.T) {
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for _, point := range []string{"files", "indexes", "before-commit", "after-commit", "after-portable"} {
		t.Run(point, func(t *testing.T) {
			dir := t.TempDir()
			root := filepath.Join(dir, "live")
			s := openTest(t, root)
			prior := publishTest(t, s, "before-disassembly", time.Date(2026, 10, 6, 0, 0, 0, 0, time.UTC))
			if err = s.Close(); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
			defer cancel()
			command := exec.CommandContext(ctx, binary, "-test.run=^TestDisassemblyCrashHelper$")
			command.Env = append(os.Environ(), "WASMFYI_DISASSEMBLY_CRASH_POINT="+point, "WASMFYI_DISASSEMBLY_CRASH_ROOT="+root)
			out, runErr := command.CombinedOutput()
			exit, ok := runErr.(*exec.ExitError)
			if !ok || exit.ExitCode() != 99 {
				t.Fatalf("crash point not reached: %v %s", runErr, out)
			}
			s = openTest(t, root)
			defer s.Close()
			id, artifact, objects := stageDisassemblyCrash(t, s)
			committed := point == "after-commit" || point == "after-portable"
			if committed == (s.Current() == prior) {
				t.Fatal("wrong publication boundary")
			}
			_, err = s.DisassemblyPage(ctx, s.Current(), artifact, 0, 0, 10)
			if committed && err != nil || !committed && !errors.Is(err, ErrNotFound) {
				t.Fatal("staging derivative visibility", err)
			}
			if !committed {
				chunk := ""
				for hash, b := range objects {
					var line wire.DisassemblyLines
					if wire.Decode(b, &line) == nil && line.Kind == "native-disassembly-lines" {
						chunk = hash
						break
					}
				}
				if chunk == "" {
					t.Fatal("missing chunk fixture")
				}
				if err = os.Remove(filepath.Join(root, "objects", chunk)); err != nil {
					t.Fatal(err)
				}
				if _, err = s.Commit(id); err == nil || s.Current() != prior {
					t.Fatal("missing derivative became public")
				}
				missing, err := s.Missing(id)
				if err != nil {
					t.Fatal(err)
				}
				found := false
				for _, o := range missing {
					if o.SHA256 == chunk {
						found = true
					}
				}
				if !found {
					t.Fatal("missing-only retry omitted diagnostic")
				}
				if err = s.InstallDeclared(chunk, bytes.NewReader(objects[chunk])); err != nil {
					t.Fatal(err)
				}
			}
			revision, err := s.Commit(id)
			if err != nil {
				t.Fatal(err)
			}
			check := func(s *Store) {
				page, err := s.DisassemblyPage(ctx, revision, artifact, 0, 0, 10)
				if err != nil || strings.Join(page.Items, "") != "header\n0: nop\n1: ret\n" {
					t.Fatal("diagnostic changed", page, err)
				}
				if repeat, err := s.Commit(id); err != nil || repeat != revision {
					t.Fatal("redelivery changed revision", err)
				}
			}
			check(s)
			backup := filepath.Join(dir, "backup")
			if _, err = s.Backup(ctx, backup); err != nil {
				t.Fatal(err)
			}
			rebuilt := filepath.Join(dir, "rebuilt")
			if err = Rebuild(backup, rebuilt, "fixture"); err != nil {
				t.Fatal(err)
			}
			recovered := openTest(t, rebuilt)
			defer recovered.Close()
			check(recovered)
		})
	}
}
