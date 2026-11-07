package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"github.com/JairusSW/wasm.fyi/service/internal/benchdb"
	"strings"
	"testing"
)

func TestArtifactHTTPAuthAndDownload(t *testing.T) {
	db, err := benchdb.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	token := strings.Repeat("x", 32)
	handler, err := NewBenchmarks(db, token, DefaultRequestLimits(), nil)
	if err != nil {
		t.Fatal(err)
	}
	a := handler.(*benchmarkAPI)
	defer a.Close()
	if err = a.EnableArtifacts(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	b := []byte{0, 97, 115, 109, 1, 0, 0, 0}
	sum := sha256.Sum256(b)
	hash := hex.EncodeToString(sum[:])
	url := "/api/artifacts/" + hash + ".wasm"
	auth := map[string]string{"Authorization": "Bearer " + token}
	if got := request(t, a, "PUT", url, b, nil); got.Code != 401 {
		t.Fatal(got.Code, got.Body.String())
	}
	if got := request(t, ReadOnlyBenchmarks(a), "PUT", url, b, auth); got.Code != 403 {
		t.Fatal(got.Code)
	}
	if got := request(t, a, "PUT", url, b, auth); got.Code != 201 {
		t.Fatal(got.Code, got.Body.String())
	}
	body, _ := json.Marshal(map[string]any{"contractSha256": hash, "workload": map[string]string{"id": "applications/test", "sha256": hash}})
	if got := request(t, a, "POST", "/api/artifacts", body, auth); got.Code != 201 {
		t.Fatal(got.Code, got.Body.String())
	}
	if got := request(t, a, "GET", "/api/artifacts?workload=applications/test", nil, nil); got.Code != 200 || !bytes.Contains(got.Body.Bytes(), []byte(hash)) {
		t.Fatal(got.Code, got.Body.String())
	}
	if got := request(t, a, "GET", url, nil, nil); got.Code != 200 || !bytes.Equal(got.Body.Bytes(), b) || got.Header().Get("Content-Type") != "application/wasm" {
		t.Fatal(got.Code, got.Body.String())
	}
	if got := request(t, a, "HEAD", url, nil, nil); got.Code != 200 || got.Body.Len() != 0 || got.Header().Get("Content-Length") != "8" {
		t.Fatal(got.Code, got.Body.String())
	}
	if got := request(t, a, "GET", url, nil, map[string]string{"Range": "bytes=0-3"}); got.Code != 206 || !bytes.Equal(got.Body.Bytes(), b[:4]) {
		t.Fatal(got.Code, got.Body.String())
	}
	if got := request(t, a, "GET", url, nil, map[string]string{"If-None-Match": `"` + hash + `"`}); got.Code != 304 {
		t.Fatal(got.Code)
	}
}
