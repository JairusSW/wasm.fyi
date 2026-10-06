package main

import (
	"bytes"
	"context"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestControlRejectsAmbiguousJSONBeforeMaintenance(t *testing.T) {
	s, root, revision, _ := controlFixture(t)
	socket := filepath.Join(root, "strict-control.sock")
	server, e := startControl(context.Background(), socket, s)
	if e != nil {
		t.Fatal(e)
	}
	defer server.Close()
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", socket)
	}, DisableKeepAlives: true}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 2 * time.Second}
	for name, body := range map[string][]byte{
		"duplicate apply":      []byte(`{"apply":false,"apply":true}`),
		"case folded key":      []byte(`{"apply":false,"Apply":true}`),
		"null document":        []byte(`null`),
		"null flag":            []byte(`{"apply":null}`),
		"null output":          []byte(`{"output":null}`),
		"unknown key":          []byte(`{"operation":"gc"}`),
		"trailing document":    []byte(`{} {}`),
		"oversized whitespace": append(bytes.Repeat([]byte(" "), 8193), []byte(`{}`)...),
	} {
		t.Run(name, func(t *testing.T) {
			request, e := http.NewRequest(http.MethodPost, "http://local/gc", bytes.NewReader(body))
			if e != nil {
				t.Fatal(e)
			}
			response, e := client.Do(request)
			if e != nil {
				t.Fatal(e)
			}
			defer response.Body.Close()
			_, _ = io.Copy(io.Discard, response.Body)
			if response.StatusCode != http.StatusBadRequest {
				t.Fatal("ambiguous maintenance JSON accepted", response.StatusCode)
			}
			if s.Current() != revision {
				t.Fatal("invalid request changed publication")
			}
			if _, e := os.Stat(filepath.Join(root, "data", "quarantine")); !os.IsNotExist(e) {
				t.Fatal("invalid request started applied cleanup", e)
			}
		})
	}
	// Each rejected request must release the single control admission slot.
	if e := callControl(context.Background(), socket, "gc", "", false, io.Discard); e != nil {
		t.Fatal("invalid request leaked admission", e)
	}
}

func TestMaintenanceJSONPreservesExplicitTypedFields(t *testing.T) {
	valid := []byte(`{"output":"/tmp/retained-λ","apply":false}`)
	request, e := decodeMaintenanceRequest(valid)
	if e != nil || request.Output != "/tmp/retained-λ" || request.Apply {
		t.Fatal(request, e)
	}
	if request, e := decodeMaintenanceRequest([]byte(`{"apply":true}`)); e != nil || !request.Apply {
		t.Fatal(request, e)
	}
	for name, body := range map[string][]byte{
		"invalid UTF8":       append([]byte(`{"output":"/tmp/`), append([]byte{0xff}, []byte(`"}`)...)...),
		"unpaired surrogate": []byte(`{"output":"/tmp/\ud800"}`),
		"escaped duplicate":  []byte(`{"apply":false,"\u0061pply":true}`),
		"array root":         []byte(`[]`),
		"string flag":        []byte(`{"apply":"true"}`),
		"numeric output":     []byte(`{"output":12}`),
	} {
		t.Run(name, func(t *testing.T) {
			if _, e := decodeMaintenanceRequest(body); e == nil {
				t.Fatal("ambiguous typed maintenance request accepted")
			}
		})
	}
}
