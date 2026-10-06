package main

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
)

func controlFixture(t *testing.T) (*store.Store, string, string, []byte) {
	t.Helper()
	root, err := os.MkdirTemp("/tmp", "wf-control-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(root) })
	s, err := store.Open(filepath.Join(root, "data"), "fixture")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	job, objects, err := testutil.Fixture("online", time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	for id, data := range objects {
		if err = s.Install(id, bytes.NewReader(data)); err != nil {
			t.Fatal(err)
		}
	}
	id, err := s.Submit(job)
	if err != nil {
		t.Fatal(err)
	}
	revision, err := s.Commit(id)
	if err != nil {
		t.Fatal(err)
	}
	key, err := s.CursorKey()
	if err != nil {
		t.Fatal(err)
	}
	return s, root, revision, key
}

func TestLiveControlBackupAndGC(t *testing.T) {
	s, root, revision, key := controlFixture(t)
	socket := filepath.Join(root, "control.sock")
	c, err := startControl(context.Background(), socket, s)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(c.Close)
	info, err := os.Lstat(socket)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("socket mode: %v %v", info, err)
	}
	// No second Pebble owner is needed by --control, even with an invalid --data.
	backup := filepath.Join(root, "backup")
	if err = run(context.Background(), []string{"backup", "--control", socket, "--data", "/does/not/exist", "--output", backup}); err != nil {
		t.Fatal(err)
	}
	manifest, err := store.VerifyBackup(context.Background(), backup)
	if err != nil || manifest.Current != revision {
		t.Fatalf("verify: %v %v", manifest, err)
	}
	rebuilt := filepath.Join(root, "rebuilt")
	if err = store.Rebuild(backup, rebuilt, "fixture"); err != nil {
		t.Fatal(err)
	}
	recovered, err := store.Open(rebuilt, "fixture")
	if err != nil {
		t.Fatal(err)
	}
	defer recovered.Close()
	actual, err := recovered.CursorKey()
	if err != nil || !bytes.Equal(actual, key) || recovered.Current() != revision {
		t.Fatal("lost revision/cursor identity", err)
	}
	for _, apply := range []bool{false, true} {
		var output bytes.Buffer
		if err = callControl(context.Background(), socket, "gc", "", apply, &output); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(output.String(), "quarantined") {
			t.Fatal(output.String())
		}
	}
	// An already canceled operation cannot expose a destination.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	canceled := filepath.Join(root, "canceled")
	if _, err = s.Backup(ctx, canceled); err == nil {
		t.Fatal("canceled backup succeeded")
	}
	if _, err = os.Lstat(canceled); !os.IsNotExist(err) {
		t.Fatal("canceled backup visible", err)
	}
	c.Close()
	if _, err = os.Lstat(socket); !os.IsNotExist(err) {
		t.Fatal("socket not removed", err)
	}
}

func TestControlAdmissionAndShutdown(t *testing.T) {
	s, root, _, _ := controlFixture(t)
	socket := filepath.Join(root, "control.sock")
	c, err := startControl(context.Background(), socket, s)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	connection, err := net.Dial("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	// Hold the admitted request in bounded body decoding, without touching storage.
	// The 100 response proves the handler owns admission and has reached
	// body decoding. Merely writing headers races a competing GC request.
	if err = connection.SetDeadline(time.Now().Add(3 * time.Second)); err != nil {
		t.Fatal(err)
	}
	_, err = fmt.Fprint(connection, "POST /gc HTTP/1.1\r\nHost: local\r\nContent-Length: 100\r\nExpect: 100-continue\r\n\r\n")
	if err != nil {
		t.Fatal(err)
	}
	response, err := http.ReadResponse(bufio.NewReader(connection), nil)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusContinue {
		t.Fatalf("maintenance request was not admitted: %d", response.StatusCode)
	}
	var output bytes.Buffer
	if err = callControl(context.Background(), socket, "gc", "", false, &output); err == nil || !strings.Contains(err.Error(), "409") {
		t.Fatalf("maintenance admission not held: %v", err)
	}
	closed := make(chan error, 1)
	c.Close()
	go func() { closed <- s.Close() }()
	select {
	case err = <-closed:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("shutdown leaked maintenance lease")
	}
}

func TestControlSocketSafety(t *testing.T) {
	s, root, _, _ := controlFixture(t)
	public := filepath.Join(root, "public")
	if err := os.Mkdir(public, 0755); err != nil {
		t.Fatal(err)
	}
	if c, err := startControl(context.Background(), filepath.Join(public, "sock"), s); err == nil {
		c.Close()
		t.Fatal("nonprivate parent accepted")
	}
	existing := filepath.Join(root, "sock")
	if err := os.WriteFile(existing, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if c, err := startControl(context.Background(), existing, s); err == nil {
		c.Close()
		t.Fatal("existing path replaced")
	}
	data, err := os.ReadFile(existing)
	if err != nil || string(data) != "keep" {
		t.Fatal("existing path changed", err)
	}
	link := filepath.Join(root, "link")
	if err := os.Symlink(root, link); err != nil {
		t.Fatal(err)
	}
	if c, err := startControl(context.Background(), filepath.Join(link, "sock2"), s); err == nil {
		c.Close()
		t.Fatal("symlink parent accepted")
	}
	if err := callControl(context.Background(), existing, "serve", "", false, &bytes.Buffer{}); err == nil {
		t.Fatal("invalid action accepted")
	}
}

func TestServeOwnsControlLifecycle(t *testing.T) {
	_, root, _, _ := controlFixture(t)
	// Use a distinct owner directory; the fixture owner stays open throughout.
	t.Setenv("WASMFYI_ADMIN_TOKEN", strings.Repeat("x", 32))
	socket := filepath.Join(root, "serve.sock")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- run(ctx, []string{"serve", "--data", filepath.Join(root, "served"), "--listen", "127.0.0.1:0", "--control-socket", socket})
	}()
	deadline := time.Now().Add(3 * time.Second)
	for {
		var output bytes.Buffer
		if err := callControl(context.Background(), socket, "gc", "", false, &output); err == nil {
			break
		}
		select {
		case err := <-done:
			t.Fatal("serve exited", err)
		default:
		}
		if time.Now().After(deadline) {
			t.Fatal("control did not become available")
		}
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("serve did not drain")
	}
	if _, err := os.Lstat(socket); !os.IsNotExist(err) {
		t.Fatal("serve left socket", err)
	}
}

type signalUploadRead struct {
	reader  io.Reader
	started chan struct{}
	once    sync.Once
}

func (r *signalUploadRead) Read(b []byte) (int, error) {
	r.once.Do(func() { close(r.started) })
	return r.reader.Read(b)
}

func TestControlCanceledQueueReleasesAdmissionWhilePublisherBlocked(t *testing.T) {
	s, root, _, _ := controlFixture(t)
	job, _, e := testutil.Fixture("held-publisher", time.Now().UTC())
	if e != nil {
		t.Fatal(e)
	}
	if _, e := s.Submit(job); e != nil {
		t.Fatal(e)
	}
	reader, writer := io.Pipe()
	defer writer.Close()
	defer reader.Close()
	waiting := &signalUploadRead{reader: reader, started: make(chan struct{})}
	uploadDone := make(chan error, 1)
	go func() { uploadDone <- s.InstallDeclared(job.Exports[0].Manifest.Objects[0].SHA256, waiting) }()
	<-waiting.started
	socket := filepath.Join(root, "control.sock")
	server, e := startControl(context.Background(), socket, s)
	if e != nil {
		t.Fatal(e)
	}
	defer server.Close()
	connection, e := net.Dial("unix", socket)
	if e != nil {
		t.Fatal(e)
	}
	defer connection.Close()
	if _, e := fmt.Fprint(connection, "POST /gc HTTP/1.1\r\nHost: local\r\nContent-Length: 2\r\n\r\n{}"); e != nil {
		t.Fatal(e)
	}
	probe := func() error {
		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		defer cancel()
		return callControl(ctx, socket, "gc", "", false, io.Discard)
	}
	deadline := time.Now().Add(3 * time.Second)
	for {
		e = probe()
		if e != nil && strings.Contains(e.Error(), "409") {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("queued control request never acquired admission", e)
		}
	}
	if e := connection.Close(); e != nil {
		t.Fatal(e)
	}
	deadline = time.Now().Add(3 * time.Second)
	for {
		e = probe()
		if errors.Is(e, context.DeadlineExceeded) {
			break
		} // admitted, now queued at the publisher
		if time.Now().After(deadline) {
			t.Fatal("canceled queue retained control admission", e)
		}
	}
	// The original publisher remains blocked throughout both control requests.
	select {
	case e := <-uploadDone:
		t.Fatal("canceled maintenance released publisher ownership", e)
	default:
	}
	if e := reader.CloseWithError(context.Canceled); e != nil {
		t.Fatal(e)
	}
	select {
	case <-uploadDone:
	case <-time.After(2 * time.Second):
		t.Fatal("upload did not release publication owner")
	}
}
