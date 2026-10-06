package api

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
)

var captureMu sync.Mutex

// Optional emitted responses feed the external test-only schema validator.
func captureResponse(t *testing.T, method, path string, w *httptest.ResponseRecorder) {
	t.Helper()
	output := os.Getenv("WASMFYI_CONTRACT_OUTPUT")
	if output == "" || method != "GET" || w.Code != 200 || !strings.HasPrefix(w.Header().Get("Content-Type"), "application/json") {
		return
	}
	body := w.Body.Bytes()
	if w.Header().Get("Content-Encoding") == "gzip" {
		reader, err := gzip.NewReader(bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		body, err = io.ReadAll(reader)
		reader.Close()
		if err != nil {
			t.Fatal(err)
		}
	}
	captureMu.Lock()
	defer captureMu.Unlock()
	file, err := os.OpenFile(output, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if err = json.NewEncoder(file).Encode(struct {
		Route  string          `json:"route"`
		Status int             `json:"status"`
		Body   json.RawMessage `json:"body"`
	}{path, w.Code, body}); err != nil {
		t.Fatal(err)
	}
}
