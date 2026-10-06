package api

import (
	"bufio"
	"bytes"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func TestNativeTCPDownloadsReleaseAdmissionOnDisconnect(t *testing.T) {
	a, handler := telemetryAPI(t, nil)
	body := bytes.Repeat([]byte{42}, wire.BlobBytes)
	job, objects, artifact, e := testutil.BinaryFixture("native-slow-client", time.Now().UTC(), body)
	if e != nil {
		t.Fatal(e)
	}
	id, e := a.Store.Submit(job)
	if e != nil {
		t.Fatal(e)
	}
	for hash, b := range objects {
		if e = a.Store.InstallDeclared(hash, bytes.NewReader(b)); e != nil {
			t.Fatal(e)
		}
	}
	revision, e := a.Store.Commit(id)
	if e != nil {
		t.Fatal(e)
	}
	server := httptest.NewServer(handler)
	defer server.Close()
	path := "/api/v1/artifacts/" + artifact + "/bytes?revision=" + revision + "&download=1"
	connections := []*net.TCPConn{}
	defer func() {
		for _, conn := range connections {
			conn.Close()
		}
	}()
	for i := 0; i < 2; i++ {
		conn, e := net.DialTimeout("tcp", strings.TrimPrefix(server.URL, "http://"), 5*time.Second)
		if e != nil {
			t.Fatal(e)
		}
		tcp := conn.(*net.TCPConn)
		connections = append(connections, tcp)
		if e = tcp.SetReadBuffer(1024); e != nil {
			t.Fatal(e)
		}
		if e = tcp.SetReadDeadline(time.Now().Add(5 * time.Second)); e != nil {
			t.Fatal(e)
		}
		if _, e = fmt.Fprintf(tcp, "GET %s HTTP/1.1\r\nHost: native-test\r\n\r\n", path); e != nil {
			t.Fatal(e)
		}
		response, e := http.ReadResponse(bufio.NewReader(tcp), nil)
		if e != nil || response.StatusCode != 200 || response.ContentLength != int64(len(body)) {
			t.Fatal("native stream failed", e)
		}
		// Leave each body unread behind a small TCP receive window. The fixture is
		// the maximum admitted object, so a full write cannot fit in these windows.
	}
	if len(a.downloading) != 2 {
		t.Fatal("native writes did not retain bounded admission")
	}
	client := &http.Client{Timeout: 5 * time.Second}
	busy, e := client.Get(server.URL + path)
	if e != nil {
		t.Fatal(e)
	}
	busy.Body.Close()
	if busy.StatusCode != 429 {
		t.Fatal("third native stream bypassed admission", busy.StatusCode)
	}
	metadata, e := client.Get(server.URL + "/api/v1/artifacts/" + artifact + "?revision=" + revision)
	if e != nil {
		t.Fatal(e)
	}
	metadata.Body.Close()
	if metadata.StatusCode != 200 {
		t.Fatal("native streams blocked metadata", metadata.StatusCode)
	}
	for _, conn := range connections {
		conn.Close()
	}
	deadline := time.Now().Add(5 * time.Second)
	for len(a.downloading) != 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if len(a.downloading) != 0 {
		t.Fatal("disconnected native streams retained permits")
	}
	head, e := client.Head(server.URL + path)
	if e != nil {
		t.Fatal(e)
	}
	head.Body.Close()
	if head.StatusCode != 200 || head.ContentLength != int64(len(body)) {
		t.Fatal("native admission did not recover")
	}
}
