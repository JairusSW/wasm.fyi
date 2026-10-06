//go:build linux

package store

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
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
	var fs unix.Statfs_t
	if e := unix.Statfs(volume, &fs); e != nil {
		t.Fatal(e)
	}
	if fs.Type != unix.TMPFS_MAGIC || uint64(fs.Blocks)*uint64(fs.Bsize) > 64<<20 {
		t.Fatal("refusing to fill anything except a small tmpfs")
	}
	entries, e := os.ReadDir(volume)
	if e != nil || len(entries) != 0 {
		t.Fatal("exhaustion volume must be empty", e)
	}
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
	fill := func() {
		t.Helper()
		f, e := os.OpenFile(filler, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
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
		f.Close()
		if !errors.Is(e, syscall.ENOSPC) {
			t.Fatal("kernel did not report ENOSPC", e)
		}
	}
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
