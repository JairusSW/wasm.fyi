package api

import (
	"bytes"
	"context"
	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestReportFileChunksAndRecovery(t *testing.T)    { testReportFileChunksAndRecovery(t, false) }
func TestReportArchiveChunksAndRecovery(t *testing.T) { testReportFileChunksAndRecovery(t, true) }
func testReportFileChunksAndRecovery(t *testing.T, archive bool) {
	dir := t.TempDir()
	s, err := store.Open(filepath.Join(dir, "live"), "test")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	job, objects, err := testutil.Fixture("bulk-files", time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	content := append(bytes.Repeat([]byte{17}, wire.ReportFileChunkBytes), []byte("tail")...)
	file := wire.ReportFile{Schema: 1, Kind: "report-file", ReportID: job.Exports[0].Manifest.ReportID, Name: "samples.parquet", MediaType: "application/vnd.apache.parquet", Encoding: "identity", SHA256: wire.Hash(content), Bytes: int64(len(content)), Chunks: []wire.FileChunk{}}
	if archive {
		file.Name = "report.tar.gz"
		file.MediaType = "application/gzip"
		file.PackingVersion = "sealed-files-tar-gzip-v1"
		file.SourceSealSHA256 = job.Exports[0].Manifest.SourceSealSHA256
	}
	for start := 0; start < len(content); start += wire.ReportFileChunkBytes {
		b := content[start:min(start+wire.ReportFileChunkBytes, len(content))]
		id := wire.Hash(b)
		objects[id] = b
		job.Exports[0].Manifest.Objects = append(job.Exports[0].Manifest.Objects, wire.Object{SHA256: id, Bytes: len(b), Kind: "binary"})
		file.Chunks = append(file.Chunks, wire.FileChunk{SHA256: id, Bytes: len(b)})
	}
	data, _ := wire.Encode(file)
	record := wire.Record{Kind: "report-file", ID: wire.Hash(data), Data: data}
	b, _ := wire.Encode(record)
	objects[wire.Hash(b)] = b
	job.Exports[0].Manifest.Objects = append(job.Exports[0].Manifest.Objects, wire.Object{SHA256: wire.Hash(b), Bytes: len(b), Kind: "record"})
	b, _ = wire.Encode(job.Exports[0].Manifest)
	job.Exports[0].SHA256 = wire.Hash(b)
	id, err := s.Submit(job)
	if err != nil {
		t.Fatal(err)
	}
	for digest, b := range objects {
		if err = s.InstallDeclared(digest, bytes.NewReader(b)); err != nil {
			t.Fatal(err)
		}
	}
	rev, err := s.Commit(id)
	if err != nil {
		t.Fatal(err)
	}
	check := func(s *store.Store) {
		t.Helper()
		h, err := New(s, strings.Repeat("x", 32), bytes.Repeat([]byte{1}, 32))
		if err != nil {
			t.Fatal(err)
		}
		list := request(t, h, "GET", "/api/v1/files?revision="+rev, nil, nil)
		if list.Code != 200 {
			t.Fatal(list.Body.String())
		}
		selected := request(t, h, "GET", "/api/v1/reports/"+file.ReportID+"/files?revision="+rev, nil, nil)
		if selected.Code != 200 || !bytes.Contains(selected.Body.Bytes(), []byte(record.ID)) {
			t.Fatal("selected report file index", selected.Code, selected.Body.String())
		}
		metadata, reader, err := s.OpenReportFile(context.Background(), rev, record.ID)
		if err != nil {
			t.Fatal(err)
		}
		metadata.Chunks[0].SHA256 = wire.Hash([]byte("caller changed descriptor"))
		frozen, err := io.ReadAll(reader)
		if err != nil || !bytes.Equal(frozen, content) {
			t.Fatal("returned descriptor mutated verified stream", err)
		}
		download := "/api/v1/files/" + record.ID + "/download?revision=" + rev
		whole := request(t, h, "GET", download, nil, nil)
		if whole.Code != 200 || !bytes.Equal(whole.Body.Bytes(), content) || whole.Header().Get("Content-Length") != "1048580" || whole.Header().Get("ETag") != `"`+file.SHA256+`"` {
			t.Fatal("whole original download differs", whole.Code)
		}
		head := request(t, h, "HEAD", download, nil, nil)
		if head.Code != 200 || head.Body.Len() != 0 || head.Header().Get("Content-Length") != whole.Header().Get("Content-Length") {
			t.Fatal("whole HEAD differs")
		}
		cached := request(t, h, "GET", download, nil, map[string]string{"If-None-Match": whole.Header().Get("ETag")})
		if cached.Code != 304 || cached.Body.Len() != 0 {
			t.Fatal("invalid whole-file cache validation")
		}
		rangeRequest := request(t, h, "GET", download, nil, map[string]string{"Range": "bytes=0-1"})
		if rangeRequest.Code != 400 {
			t.Fatal("ambiguous bulk range accepted")
		}
		var assembled []byte
		for _, chunk := range file.Chunks {
			path := "/api/v1/files/" + record.ID + "/chunks/" + chunk.SHA256 + "?revision=" + rev
			response := request(t, h, "GET", path, nil, nil)
			if response.Code != 200 || response.Body.Len() != chunk.Bytes {
				t.Fatal(response.Code, response.Body.String())
			}
			assembled = append(assembled, response.Body.Bytes()...)
			head := request(t, h, "HEAD", path, nil, nil)
			if head.Code != 200 || head.Body.Len() != 0 {
				t.Fatal("invalid HEAD")
			}
		}
		if !bytes.Equal(content, assembled) {
			t.Fatal("original bytes changed")
		}
		forged := request(t, h, "GET", "/api/v1/files/"+record.ID+"/chunks/"+wire.Hash([]byte("other"))+"?revision="+rev, nil, nil)
		if forged.Code != 404 {
			t.Fatal("unbound bytes exposed", forged.Code)
		}
	}
	check(s)
	backup := filepath.Join(dir, "backup")
	if _, err = s.Backup(context.Background(), backup); err != nil {
		t.Fatal(err)
	}
	if err = store.Rebuild(backup, filepath.Join(dir, "rebuilt"), "test"); err != nil {
		t.Fatal(err)
	}
	r, err := store.Open(filepath.Join(dir, "rebuilt"), "test")
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	check(r)
	// Corruption after preflight terminates a real HTTP stream. A declared full
	// Content-Length must not make a truncated file look complete to the client.
	h, err := New(s, strings.Repeat("x", 32), bytes.Repeat([]byte{1}, 32))
	if err != nil {
		t.Fatal(err)
	}
	tailPath := filepath.Join(dir, "live", "objects", file.Chunks[1].SHA256)
	corruptResult := make(chan error, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		h.ServeHTTP(&afterWrite{ResponseWriter: w, change: func() { corruptResult <- os.WriteFile(tailPath, []byte("oops"), 0600) }}, req)
	}))
	defer server.Close()
	response, err := server.Client().Get(server.URL + "/api/v1/files/" + record.ID + "/download?revision=" + rev)
	if err != nil {
		t.Fatal("stream never started", err)
	}
	partial, readErr := io.ReadAll(response.Body)
	response.Body.Close()
	if readErr == nil || len(partial) >= len(content) || response.StatusCode != 200 {
		t.Fatal("late corruption looked like complete download", readErr, len(partial))
	}
	if err := <-corruptResult; err != nil {
		t.Fatal(err)
	}
	preflight := request(t, h, "GET", "/api/v1/files/"+record.ID+"/download?revision="+rev, nil, nil)
	if preflight.Code < 400 || bytes.Contains(preflight.Body.Bytes(), content[:64]) {
		t.Fatal("corrupt file emitted success bytes before preflight")
	}
	if err = os.WriteFile(tailPath, content[wire.ReportFileChunkBytes:], 0600); err != nil {
		t.Fatal(err)
	}

}

type afterWrite struct {
	http.ResponseWriter
	once   sync.Once
	change func()
}

func (w *afterWrite) Write(b []byte) (int, error) {
	n, err := w.ResponseWriter.Write(b)
	w.once.Do(w.change)
	return n, err
}
func (w *afterWrite) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func TestReportFileDownloadAdmissionAndFailureRelease(t *testing.T) {
	s, err := store.Open(t.TempDir(), "test")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	a := &API{Store: s, downloading: make(chan struct{}, 2)}
	path := "/api/v1/files/" + wire.Hash([]byte("missing")) + "/download"
	req := httptest.NewRequest("GET", path, nil)
	a.downloading <- struct{}{}
	a.downloading <- struct{}{}
	busy := httptest.NewRecorder()
	a.reportFileDownload(busy, req, "", wire.Hash([]byte("missing")))
	if busy.Code != 429 || len(a.downloading) != 2 {
		t.Fatal("bulk budget bypassed", busy.Code)
	}
	<-a.downloading
	<-a.downloading
	failed := httptest.NewRecorder()
	a.reportFileDownload(failed, req, "", wire.Hash([]byte("missing")))
	if failed.Code < 400 || len(a.downloading) != 0 {
		t.Fatal("failed download leaked admission", failed.Code, len(a.downloading))
	}
}
