package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func TestSelectedNativeBytesAndInspection(t *testing.T) {
	s, err := store.Open(t.TempDir(), "fixture")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	handler, err := New(s, strings.Repeat("x", 32), bytes.Repeat([]byte{1}, 32))
	if err != nil {
		t.Fatal(err)
	}
	data := bytes.Repeat([]byte{0x90, 0xc3}, 700000)
	job, objects, artifact, err := testutil.BinaryFixture("byte-api", time.Now().UTC(), data)
	if err != nil {
		t.Fatal(err)
	}
	id, err := s.Submit(job)
	if err != nil {
		t.Fatal(err)
	}
	for hash, b := range objects {
		if err = s.InstallDeclared(hash, bytes.NewReader(b)); err != nil {
			t.Fatal(err)
		}
	}
	revision, err := s.Commit(id)
	if err != nil {
		t.Fatal(err)
	}
	path := "/api/v1/artifacts/" + artifact + "/bytes?revision=" + revision
	selected := request(t, handler, "GET", path+"&offset=7&length=33", nil, nil)
	if selected.Code != 206 || !bytes.Equal(selected.Body.Bytes(), data[7:40]) || selected.Header().Get("Content-Range") != "bytes 7-39/1400000" {
		t.Fatal("bad selected range", selected.Code, selected.Body.String())
	}
	ranged := request(t, handler, "GET", strings.Replace(path, "/bytes?", "/content?", 1), nil, map[string]string{"Range": "bytes=7-39"})
	if ranged.Code != 206 || !bytes.Equal(ranged.Body.Bytes(), data[7:40]) {
		t.Fatal("HTTP range changed bytes", ranged.Code)
	}
	invalidRange := request(t, handler, "GET", path, nil, map[string]string{"Range": "bytes=0-"})
	if invalidRange.Code != 416 {
		t.Fatal("unbounded HTTP range accepted", invalidRange.Code)
	}
	first := request(t, handler, "GET", path, nil, nil)
	if first.Code != 206 || first.Body.Len() != wire.ResponseBytes {
		t.Fatal("unbounded ordinary byte read", first.Code, first.Body.Len())
	}
	full := request(t, handler, "GET", path+"&download=1", nil, nil)
	if full.Code != 200 || !bytes.Equal(full.Body.Bytes(), data) || !strings.Contains(full.Header().Get("Content-Disposition"), "attachment") {
		t.Fatal("original download changed")
	}
	unchanged := request(t, handler, "GET", path+"&offset=7&length=33", nil, map[string]string{"If-None-Match": selected.Header().Get("ETag")})
	if unchanged.Code != http.StatusNotModified || unchanged.Body.Len() != 0 {
		t.Fatal("range cache validator failed")
	}
	for _, query := range []string{"&length=1048577", "&offset=-1", "&download=1&length=20", "&length=1&length=2", "&unexpected=1"} {
		bad := request(t, handler, "GET", path+query, nil, nil)
		if bad.Code != 400 {
			t.Fatal("accepted ambiguous/unbounded byte query", query, bad.Code)
		}
	}
	meta := request(t, handler, "GET", "/api/v1/artifacts/"+artifact+"/inspection?revision="+revision, nil, nil)
	if meta.Code != 200 || strings.Contains(meta.Body.String(), `"data"`) {
		t.Fatal("inspection loaded raw bytes", meta.Code)
	}
	forged := request(t, handler, "GET", "/api/v1/artifacts/"+artifact+"/inspection?revision="+revision+"&chunk="+strings.Repeat("a", 64), nil, nil)
	if forged.Code != 404 {
		t.Fatal("inspection leaked unrelated content")
	}
	var descriptor wire.Artifact
	for _, b := range objects {
		var record wire.Record
		if json.Unmarshal(b, &record) == nil && record.Kind == "artifact" {
			descriptor, _ = wire.ArtifactData(record.Data)
		}
	}
	if descriptor.Content.SHA256 != wire.Hash(data) {
		t.Fatal("original identity lost")
	}
}
