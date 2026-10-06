//go:build linux

package store

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"golang.org/x/sys/unix"
)

// This gate may exhaust only an explicitly selected, empty, small tmpfs. It
// skips ordinary developer/CI runs and never fills the host workspace volume.
func TestKernelDiskExhaustionPreservesPublicationAndRecovery(t *testing.T) {
	volume := os.Getenv("WASMFYI_ENOSPC_ROOT")
	if volume == "" {
		t.Skip("set WASMFYI_ENOSPC_ROOT to an isolated empty tmpfs")
	}
	assertExhaustionVolume(t, volume)
	root := filepath.Join(volume, "store")
	s := openTest(t, root)
	defer func() {
		if s != nil {
			s.Close()
		}
	}()
	first := publishTest(t, s, "disk-full-baseline", time.Now().UTC())
	job, objects, e := testutil.Fixture("disk-full-pending", time.Now().UTC().Add(time.Hour))
	if e != nil {
		t.Fatal(e)
	}
	extra := bytes.Repeat([]byte{42}, 128<<10)
	extraID := wire.Hash(extra)
	job.Exports[0].Manifest.Objects = append(job.Exports[0].Manifest.Objects, wire.Object{SHA256: extraID, Bytes: len(extra), Kind: "binary"})
	manifest, _ := wire.Encode(job.Exports[0].Manifest)
	job.Exports[0].SHA256 = wire.Hash(manifest)
	id, e := s.Submit(job)
	if e != nil {
		t.Fatal(e)
	}
	for digest, body := range objects {
		if e = s.InstallDeclared(digest, bytes.NewReader(body)); e != nil {
			t.Fatal(e)
		}
	}
	filler := filepath.Join(volume, "filler")
	fill := func() { fillExhaustionVolume(t, filler) }
	defer os.Remove(filler)
	fill()
	if e = s.InstallDeclared(extraID, bytes.NewReader(extra)); !errors.Is(e, syscall.ENOSPC) {
		t.Fatal("upload did not encounter kernel exhaustion", e)
	}
	if _, e = s.content(extraID); !os.IsNotExist(e) {
		t.Fatal("partial canonical upload survived", e)
	}
	if s.Current() != first {
		t.Fatal("failed upload advanced public revision")
	}
	if e = os.Remove(filler); e != nil {
		t.Fatal(e)
	}
	if e = s.InstallDeclared(extraID, bytes.NewReader(extra)); e != nil {
		t.Fatal("upload retry failed", e)
	}
	fill()
	_, e = s.Commit(id)
	if !errors.Is(e, syscall.ENOSPC) {
		t.Fatal("publication did not encounter real exhaustion", e)
	}
	if s.Current() != first {
		t.Fatal("partial revision became public")
	}
	rows, e := s.Results(Query{Revision: first}, false)
	if e != nil || len(rows) != 3 {
		t.Fatal("committed reads lost under exhaustion", e, len(rows))
	}
	if e = os.Remove(filler); e != nil {
		t.Fatal(e)
	}
	second, e := s.Commit(id)
	if e != nil || second == first {
		t.Fatal("retry after freeing space failed", e)
	}
	again, e := s.Commit(id)
	if e != nil || again != second {
		t.Fatal("retry was not idempotent", e)
	}
	if e = s.Close(); e != nil {
		t.Fatal(e)
	}
	s = nil
	s = openTest(t, root)
	if s.Current() != second {
		t.Fatal("restart lost durable retry")
	}
	rows, e = s.Results(Query{Revision: second}, true)
	if e != nil || len(rows) != 6 {
		t.Fatal("restart lost captures", e, len(rows))
	}
	// Recovery targets are on a separate test filesystem, not the exhausted one.
	backup := filepath.Join(t.TempDir(), "backup")
	if _, e = s.Backup(context.Background(), backup); e != nil {
		t.Fatal(e)
	}
	rebuilt := filepath.Join(t.TempDir(), "rebuilt")
	if e = Rebuild(backup, rebuilt, "fixture-publisher"); e != nil {
		t.Fatal(e)
	}
	recovered := openTest(t, rebuilt)
	defer recovered.Close()
	if recovered.Current() != second {
		t.Fatal("portable rebuild changed committed head")
	}
	rows, e = recovered.Results(Query{Revision: second}, true)
	if e != nil || len(rows) != 6 {
		t.Fatal("portable rebuild lost retried captures", e, len(rows))
	}
}

// Both parent and subprocess enforce the filesystem guard. The parent also
// requires an empty volume before creating its own store.
func assertSmallTmpfs(t *testing.T, volume string) {
	t.Helper()
	abs, e := filepath.Abs(volume)
	if e != nil {
		t.Fatal(e)
	}
	info, e := os.Lstat(abs)
	if e != nil || !info.IsDir() {
		t.Fatal("exhaustion root must be a real directory", e)
	}
	parent, e := os.Stat(filepath.Dir(abs))
	if e != nil {
		t.Fatal(e)
	}
	if info.Sys().(*syscall.Stat_t).Dev == parent.Sys().(*syscall.Stat_t).Dev {
		t.Fatal("exhaustion root must be a dedicated tmpfs mount")
	}
	var fs unix.Statfs_t
	if e := unix.Statfs(volume, &fs); e != nil {
		t.Fatal(e)
	}
	if fs.Type != unix.TMPFS_MAGIC || uint64(fs.Blocks)*uint64(fs.Bsize) > 64<<20 {
		t.Fatal("refusing to fill anything except a small tmpfs")
	}
}
func assertExhaustionVolume(t *testing.T, volume string) {
	t.Helper()
	assertSmallTmpfs(t, volume)
	entries, e := os.ReadDir(volume)
	if e != nil || len(entries) != 0 {
		t.Fatal("exhaustion volume must be empty", e)
	}
}
func fillExhaustionVolume(t *testing.T, path string) {
	t.Helper()
	f, e := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		t.Fatal(e)
	}
	block := make([]byte, 1<<20)
	for {
		_, e = f.Write(block)
		if e != nil {
			break
		}
	}
	closeErr := f.Close()
	if !errors.Is(e, syscall.ENOSPC) || closeErr != nil {
		t.Fatal("kernel exhaustion failed", e, closeErr)
	}
}

func TestKernelWALExhaustionHelper(t *testing.T) {
	volume := os.Getenv("WASMFYI_WAL_EXHAUSTION_HELPER")
	if volume == "" {
		t.Skip("subprocess helper")
	}
	assertSmallTmpfs(t, volume)
	s := openTest(t, filepath.Join(volume, "store"))
	previous := s.Current()
	id := stage(t, s, "wal-full-pending", time.Date(2026, 10, 6, 1, 0, 0, 0, time.UTC))
	s.fail = func(point string) error {
		if point == "before-commit" {
			if e := os.WriteFile(os.Getenv("WASMFYI_WAL_CHECKPOINT"), []byte("before-commit"), 0600); e != nil {
				t.Fatal(e)
			}
			fillExhaustionVolume(t, filepath.Join(volume, "filler"))
		}
		return nil
	}
	_, e := s.Commit(id)
	if !errors.Is(e, syscall.ENOSPC) {
		t.Fatal("synchronous publication did not return kernel ENOSPC", e)
	}
	if !s.poisoned.Load() || s.Current() != previous {
		t.Fatal("uncertain commit remained writable or advanced public head")
	}
	if _, e = s.Commit(id); !errors.Is(e, ErrNeedsRestart) {
		t.Fatal("uncertain WAL allowed another commit", e)
	}
	// Do not close a database with a failed WAL: emulate abrupt process loss,
	// releasing the OS lock before the parent frees space and recovers it.
	os.Exit(77)
}

func TestKernelWALExhaustionRecovery(t *testing.T) {
	volume := os.Getenv("WASMFYI_ENOSPC_ROOT")
	if volume == "" {
		t.Skip("set WASMFYI_ENOSPC_ROOT to an isolated empty tmpfs")
	}
	assertExhaustionVolume(t, volume)
	root := filepath.Join(volume, "store")
	s := openTest(t, root)
	previous := publishTest(t, s, "wal-full-baseline", time.Date(2026, 10, 6, 0, 0, 0, 0, time.UTC))
	baseline, e := s.Results(Query{Revision: previous}, true)
	if e != nil {
		t.Fatal(e)
	}
	if e := s.Close(); e != nil {
		t.Fatal(e)
	}
	binary, e := os.Executable()
	if e != nil {
		t.Fatal(e)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	child := exec.CommandContext(ctx, binary, "-test.run=^TestKernelWALExhaustionHelper$", "-test.v")
	checkpoint := filepath.Join(t.TempDir(), "checkpoint")
	child.Env = append(os.Environ(), "WASMFYI_WAL_EXHAUSTION_HELPER="+volume, "WASMFYI_WAL_CHECKPOINT="+checkpoint)
	output, e := child.CombinedOutput()
	exit, ok := e.(*exec.ExitError)
	fatalWAL := ok && exit.ExitCode() == 1 && strings.Contains(string(output), "pebble: fatal commit error: write ") && strings.Contains(string(output), ".log: no space left on device")
	if !ok || (exit.ExitCode() != 77 && !fatalWAL) {
		t.Fatalf("WAL helper did not reach failed sync gate: %v\n%s", e, output)
	}
	mark, e := os.ReadFile(checkpoint)
	if e != nil || string(mark) != "before-commit" {
		t.Fatal("WAL exhaustion checkpoint missing", e)
	}
	t.Logf("failed WAL process output:\n%s", output)
	if e = os.Remove(filepath.Join(volume, "filler")); e != nil {
		t.Fatal(e)
	}
	s = openTest(t, root)
	defer func() {
		if s != nil {
			s.Close()
		}
	}()
	if s.Current() != previous {
		t.Fatal("failed WAL commit changed recovered head")
	}
	rows, e := s.Results(Query{Revision: previous}, true)
	if e != nil || !reflect.DeepEqual(rows, baseline) {
		t.Fatal("failed WAL changed baseline", e, len(rows))
	}
	id := stage(t, s, "wal-full-pending", time.Date(2026, 10, 6, 1, 0, 0, 0, time.UTC))
	second, e := s.Commit(id)
	if e != nil || second == previous {
		t.Fatal("restarted WAL retry failed", e)
	}
	again, e := s.Commit(id)
	if e != nil || again != second {
		t.Fatal("restarted WAL retry not idempotent", e)
	}
	rows, e = s.Results(Query{Revision: second}, true)
	if e != nil || len(rows) != 6 {
		t.Fatal("WAL retry lost or duplicated captures", e, len(rows))
	}
	if e = s.Close(); e != nil {
		t.Fatal(e)
	}
	s = nil
	s = openTest(t, root)
	if s.Current() != second {
		t.Fatal("WAL retry did not survive another restart")
	}
	after, e := s.Results(Query{Revision: second}, true)
	if e != nil || !reflect.DeepEqual(after, rows) {
		t.Fatal("WAL restart changed captures", e)
	}
	backup := filepath.Join(t.TempDir(), "backup")
	if _, e = s.Backup(context.Background(), backup); e != nil {
		t.Fatal(e)
	}
	rebuilt := filepath.Join(t.TempDir(), "rebuilt")
	if e = Rebuild(backup, rebuilt, "fixture-publisher"); e != nil {
		t.Fatal(e)
	}
	recovered := openTest(t, rebuilt)
	defer recovered.Close()
	if recovered.Current() != second {
		t.Fatal("WAL portable rebuild changed head")
	}
	after, e = recovered.Results(Query{Revision: second}, true)
	if e != nil || !reflect.DeepEqual(after, rows) {
		t.Fatal("WAL portable rebuild changed captures", e)
	}
}

func TestKernelDiskExhaustionRefusesNestedDirectory(t *testing.T) {
	volume := os.Getenv("WASMFYI_ENOSPC_ROOT")
	if volume == "" {
		t.Skip("set WASMFYI_ENOSPC_ROOT to an isolated empty tmpfs")
	}
	assertExhaustionVolume(t, volume)
	nested := filepath.Join(volume, "empty-shared-subdirectory")
	if e := os.Mkdir(nested, 0700); e != nil {
		t.Fatal(e)
	}
	defer os.Remove(nested)
	binary, e := os.Executable()
	if e != nil {
		t.Fatal(e)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	child := exec.CommandContext(ctx, binary, "-test.run=^TestKernelWALExhaustionHelper$")
	child.Env = append(os.Environ(), "WASMFYI_WAL_EXHAUSTION_HELPER="+nested)
	output, e := child.CombinedOutput()
	exit, ok := e.(*exec.ExitError)
	if !ok || exit.ExitCode() != 1 || !strings.Contains(string(output), "exhaustion root must be a dedicated tmpfs mount") {
		t.Fatalf("shared tmpfs directory was not refused: %v\n%s", e, output)
	}
	entries, e := os.ReadDir(nested)
	if e != nil || len(entries) != 0 {
		t.Fatal("refused target was modified", e)
	}
}
