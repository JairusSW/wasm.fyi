package api

import (
	"bufio"
	"context"
	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

type zeroStream struct{}

func (zeroStream) Read(b []byte) (int, error) { clear(b); return len(b), nil }
func TestSlowDownloadsCancelAndReleaseShutdownLeases(t *testing.T) {
	s, err := store.Open(t.TempDir(), "test")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	a := &API{Store: s, downloading: make(chan struct{}, 2)}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	started := make(chan struct{}, 2)
	finished := make(chan struct{}, 2)
	var opened atomic.Int32
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		finish, err := s.Lease()
		if err != nil {
			w.WriteHeader(503)
			return
		}
		defer finish()
		if r.URL.Path == "/healthz" {
			w.WriteHeader(200)
			return
		}
		defer func() { finished <- struct{}{} }()
		a.download(w, r, func() (downloadInfo, io.Reader, error) {
			opened.Add(1)
			started <- struct{}{}
			return downloadInfo{"synthetic.bin", "application/octet-stream", wire.Hash([]byte("synthetic transport stress; no measurement evidence")), 64 << 20}, io.LimitReader(zeroStream{}, 64<<20), nil
		})
	}))
	server.Config.BaseContext = func(net.Listener) context.Context { return ctx }
	server.Start()
	defer server.Close()
	connections := []net.Conn{}
	defer func() {
		for _, c := range connections {
			c.Close()
		}
	}()
	for i := 0; i < 2; i++ {
		conn, err := net.DialTimeout("tcp", server.Listener.Addr().String(), 5*time.Second)
		if err != nil {
			t.Fatal(err)
		}
		connections = append(connections, conn)
		_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		if _, err = io.WriteString(conn, "GET /download HTTP/1.1\r\nHost: test\r\n\r\n"); err != nil {
			t.Fatal(err)
		}
		response, err := http.ReadResponse(bufio.NewReader(conn), nil)
		if err != nil || response.StatusCode != 200 {
			t.Fatal("stream did not start", err)
		}
		// Keep the TCP connection open without consuming the response body.
		select {
		case <-started:
		case <-time.After(5 * time.Second):
			t.Fatal("download loader not entered")
		}
	}
	third, err := server.Client().Get(server.URL + "/download")
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, third.Body)
	third.Body.Close()
	if third.StatusCode != 429 || opened.Load() != 2 {
		t.Fatal("slow clients bypassed bulk admission", third.StatusCode, opened.Load())
	}
	health, err := server.Client().Get(server.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	health.Body.Close()
	if health.StatusCode != 200 {
		t.Fatal("bulk clients blocked unrelated reads")
	}
	closed := make(chan error, 1)
	go func() { closed <- s.Close() }()
	select {
	case err := <-closed:
		t.Fatal("shutdown did not wait for admitted bulk leases", err)
	case <-time.After(50 * time.Millisecond):
	}
	// Remove the budget-rejected handler notification before checking real streams.
	<-finished
	cancel()
	for i := 0; i < 2; i++ {
		select {
		case <-finished:
		case <-time.After(5 * time.Second):
			t.Fatal("cancellation did not unblock slow socket writes")
		}
	}
	select {
	case err := <-closed:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("shutdown remained blocked after stream cancellation")
	}
	if len(a.downloading) != 0 {
		t.Fatal("canceled streams leaked download permits")
	}
}
