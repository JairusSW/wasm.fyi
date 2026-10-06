package api

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestArchivePublishedScopePaginationAndRecovery(t *testing.T) {
	dir := t.TempDir()
	s, err := store.Open(filepath.Join(dir, "live"), "test")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	old := importFixture(t, s, "archive-before", time.Now().UTC())
	job, objects, err := testutil.Fixture("archive-source", time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	job.Session = "archive-session"
	original := append(bytes.Repeat([]byte{17}, wire.ReportFileChunkBytes), []byte("archive tail")...)
	metadata, _ := wire.Encode(map[string]any{"planSha256": job.Plan, "scope": "unlisted OS/native-library prerequisites remain"})
	var metadataPretty bytes.Buffer
	if err := json.Indent(&metadataPretty, metadata, "", "  "); err != nil {
		t.Fatal(err)
	}
	metadata = append(metadataPretty.Bytes(), '\n')
	index, _ := wire.Encode(map[string]any{"schema": 1, "id": job.Session, "machine": job.Machine, "metadata": "metadata.json", "metadataSha256": wire.Hash(metadata), "bytes": len(original), "sha256": wire.Hash(original), "parts": []any{map[string]any{"path": "bundle.tar.gz.part-000", "bytes": len(original), "sha256": wire.Hash(original)}}})
	var indexPretty bytes.Buffer
	if err := json.Indent(&indexPretty, index, "", "  "); err != nil {
		t.Fatal(err)
	}
	index = append(indexPretty.Bytes(), '\n')
	parent := &wire.ParentArchive{Schema: 1, Index: wire.Object{SHA256: wire.Hash(index), Bytes: len(index), Kind: "evidence"}, Metadata: wire.Object{SHA256: wire.Hash(metadata), Bytes: len(metadata), Kind: "evidence"}, SHA256: wire.Hash(original), Bytes: int64(len(original)), Chunks: []wire.Object{}}
	objects[wire.Hash(index)] = index
	objects[wire.Hash(metadata)] = metadata
	for start := 0; start < len(original); start += wire.ReportFileChunkBytes {
		b := original[start:min(start+wire.ReportFileChunkBytes, len(original))]
		o := wire.Object{SHA256: wire.Hash(b), Bytes: len(b), Kind: "binary"}
		parent.Chunks = append(parent.Chunks, o)
		objects[o.SHA256] = b
	}
	job.ParentBundleSHA256 = parent.Index.SHA256
	job.ParentArchive = parent
	id, err := s.Submit(job)
	if err != nil {
		t.Fatal(err)
	}
	for digest, b := range objects {
		if err = s.InstallDeclared(digest, bytes.NewReader(b)); err != nil {
			t.Fatal(err)
		}
	}
	h, err := New(s, strings.Repeat("x", 32), bytes.Repeat([]byte{1}, 32))
	if err != nil {
		t.Fatal(err)
	}
	path := "/api/v1/archives/" + id
	if response := request(t, h, "GET", path+"?revision="+old, nil, nil); response.Code != 404 {
		t.Fatal("staging archive exposed", response.Code)
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
		legacyRev, err := s.Revision(old)
		if err != nil {
			t.Fatal(err)
		}
		legacy := request(t, h, "GET", "/api/v1/archives/"+legacyRev.Job+"?revision="+old, nil, nil)
		if legacy.Code != 200 || !bytes.Contains(legacy.Body.Bytes(), []byte(`"status":"not_imported"`)) {
			t.Fatal("legacy archive availability inferred", legacy.Code, legacy.Body.String())
		}
		unavailable := request(t, h, "GET", "/api/v1/archives/"+legacyRev.Job+"/download?revision="+old, nil, nil)
		if unavailable.Code != 404 {
			t.Fatal("legacy missing bytes downloadable")
		}
		descriptor := request(t, h, "GET", path+"?revision="+rev, nil, nil)
		if descriptor.Code != 200 || descriptor.Body.Len() > 10*1024 || bytes.Contains(descriptor.Body.Bytes(), []byte("chunks")) {
			t.Fatal("descriptor was not bounded", descriptor.Code, descriptor.Body.String())
		}
		for resource, expected := range map[string][]byte{"index": index, "metadata": metadata} {
			response := request(t, h, "GET", path+"/"+resource+"?revision="+rev, nil, nil)
			if response.Code != 200 {
				t.Fatal(response.Body.String())
			}
			if !bytes.Equal(response.Body.Bytes(), expected) {
				t.Fatal("original source JSON bytes changed")
			}
			var got any
			var want any
			_ = json.Unmarshal(response.Body.Bytes(), &got)
			_ = json.Unmarshal(expected, &want)
			a, _ := json.Marshal(got)
			b, _ := json.Marshal(want)
			if !bytes.Equal(a, b) {
				t.Fatal("source metadata drift")
			}
		}
		page := request(t, h, "GET", path+"/chunks?revision="+rev+"&limit=1", nil, nil)
		if page.Code != 200 {
			t.Fatal(page.Body.String())
		}
		var response struct {
			Items    []wire.Object `json:"items"`
			Next     string        `json:"nextCursor"`
			Complete bool          `json:"complete"`
		}
		if err = json.Unmarshal(page.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		if response.Complete || response.Next == "" || len(response.Items) != 1 {
			t.Fatal("chunk pagination lost remainder")
		}
		next := request(t, h, "GET", path+"/chunks?limit=1&cursor="+response.Next, nil, nil)
		if next.Code != 200 {
			t.Fatal(next.Body.String())
		}
		forged := request(t, h, "GET", path+"/chunks/"+wire.Hash([]byte("other"))+"?revision="+rev, nil, nil)
		if forged.Code != 404 {
			t.Fatal("unbound content exposed")
		}
		for _, o := range parent.Chunks {
			chunk := request(t, h, "GET", path+"/chunks/"+o.SHA256+"?revision="+rev, nil, nil)
			if chunk.Code != 200 || !bytes.Equal(chunk.Body.Bytes(), objects[o.SHA256]) {
				t.Fatal("chunk drift")
			}
		}
		whole := request(t, h, "GET", path+"/download?revision="+rev, nil, nil)
		if whole.Code != 200 || !bytes.Equal(whole.Body.Bytes(), original) {
			t.Fatal("whole archive drift", whole.Code)
		}
		head := request(t, h, "HEAD", path+"/download?revision="+rev, nil, nil)
		if head.Code != 200 || head.Body.Len() != 0 {
			t.Fatal("invalid archive HEAD")
		}
		frozen := request(t, h, "GET", path+"?revision="+old, nil, nil)
		if frozen.Code != 404 {
			t.Fatal("archive leaked into older revision")
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
	rebuilt, err := store.Open(filepath.Join(dir, "rebuilt"), "test")
	if err != nil {
		t.Fatal(err)
	}
	defer rebuilt.Close()
	check(rebuilt)
}
