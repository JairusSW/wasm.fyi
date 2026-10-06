package store

import (
	"bytes"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/cockroachdb/pebble/v2"
	"github.com/cockroachdb/pebble/v2/vfs"
)

func TestFilesystemSpaceAndStorageStats(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	stats, e := s.Stats()
	if e != nil {
		t.Fatal(e)
	}
	if stats.Filesystem.Status != "available" || stats.Filesystem.AvailableBytes == nil || stats.Filesystem.TotalBytes == nil || *stats.Filesystem.TotalBytes == 0 || *stats.Filesystem.AvailableBytes > *stats.Filesystem.TotalBytes {
		t.Fatal("native filesystem space unavailable", stats.Filesystem)
	}
	missing := filesystemSpace(filepath.Join(t.TempDir(), "missing"))
	if missing.Status != "unavailable" || missing.AvailableBytes != nil || missing.TotalBytes != nil {
		t.Fatal("missing filesystem represented as zero", missing)
	}
	if stats.WriteStalls.Version != "pebble-write-stalls-v1" || s.stalls == nil {
		t.Fatal("store stall instrumentation absent")
	}
}
func TestWriteStallsIncludeActiveTimeAndOverlap(t *testing.T) {
	m := &writeStallMetrics{}
	start := time.Now()
	m.begin("memtable count limit reached", start)
	m.begin("L0 file count limit exceeded", start.Add(time.Second))
	v := m.snapshot(start.Add(2 * time.Second))
	if v.Active != 2 || v.Count != 2 || v.DurationNS != uint64(3*time.Second) || v.Memtable != 1 || v.Level0 != 1 {
		t.Fatal(v)
	}
	m.end(start.Add(3 * time.Second))
	m.end(start.Add(4 * time.Second))
	m.end(start.Add(5 * time.Second))
	v = m.snapshot(start.Add(6 * time.Second))
	if v.Active != 0 || v.DurationNS != uint64(6*time.Second) || v.Count != 2 {
		t.Fatal("end or snapshot changed duration", v)
	}
}
func TestPebbleWriteStallCallbacksObserveRealPressure(t *testing.T) {
	m := &writeStallMetrics{}
	listener := m.listener()
	flushing := make(chan struct{})
	release := make(chan struct{})
	stalled := make(chan struct{})
	var stallOnce sync.Once
	original := listener.WriteStallBegin
	listener.WriteStallBegin = func(info pebble.WriteStallBeginInfo) { original(info); stallOnce.Do(func() { close(stalled) }) }
	fs := &blockedSSTFS{FS: vfs.Default, started: flushing, release: release}
	db, e := pebble.Open(t.TempDir(), &pebble.Options{MemTableSize: 64 << 10, MemTableStopWritesThreshold: 2, EventListener: listener, FS: fs})
	if e != nil {
		t.Fatal(e)
	}
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	finished := make(chan struct{})
	defer func() { unblock(); <-finished; db.Close() }()
	done := make(chan error, 1)
	go func() {
		defer close(finished)
		for i := 0; i < 100; i++ {
			key := []byte{byte(i)}
			if e := db.Set(key, bytes.Repeat([]byte{byte(i)}, 4096), pebble.NoSync); e != nil {
				done <- e
				return
			}
		}
		done <- nil
	}()
	select {
	case <-flushing:
	case <-time.After(10 * time.Second):
		unblock()
		t.Fatal("flush did not start")
	}
	select {
	case <-stalled:
	case e := <-done:
		unblock()
		t.Fatal("writes did not stall", e)
	case <-time.After(10 * time.Second):
		unblock()
		t.Fatal("stall callback missing")
	}
	v := m.snapshot(time.Now())
	if v.Active == 0 || v.Count == 0 || v.Memtable == 0 {
		unblock()
		t.Fatal("pressure absent from metrics", v)
	}
	unblock()
	select {
	case e := <-done:
		if e != nil {
			t.Fatal(e)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("writes did not resume")
	}
	v = m.snapshot(time.Now())
	if v.Active != 0 || v.DurationNS == 0 {
		t.Fatal("stall never ended", v)
	}
}

type blockedSSTFS struct {
	vfs.FS
	started chan struct{}
	release <-chan struct{}
	once    sync.Once
}

func (f *blockedSSTFS) Create(name string, category vfs.DiskWriteCategory) (vfs.File, error) {
	file, e := f.FS.Create(name, category)
	if e != nil {
		return nil, e
	}
	if strings.HasSuffix(name, ".sst") {
		return &blockedSSTFile{File: file, fs: f}, nil
	}
	return file, nil
}

type blockedSSTFile struct {
	vfs.File
	fs *blockedSSTFS
}

func (f *blockedSSTFile) Write(b []byte) (int, error) {
	f.fs.once.Do(func() { close(f.fs.started) })
	<-f.fs.release
	return f.File.Write(b)
}
