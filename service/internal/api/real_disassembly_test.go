package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

// Real fixture qualification preserves production admission. A selected read
// can retry a bounded rate-limit response without changing its revision/cursor.
func realFixtureGET(t *testing.T, h http.Handler, path string) *httptest.ResponseRecorder {
	t.Helper()
	for retries := 0; retries < 4; retries++ {
		response := request(t, h, "GET", path, nil, nil)
		if response.Code != http.StatusTooManyRequests {
			return response
		}
		delay, err := strconv.Atoi(response.Header().Get("Retry-After"))
		if err != nil || delay < 1 || delay > 30 {
			t.Fatal("invalid real-fixture Retry-After", response.Header())
		}
		time.Sleep(time.Duration(delay) * time.Second)
	}
	t.Fatal("real-fixture rate-limit retries exhausted")
	return nil
}

// Read archive records one at a time; retain only first/middle/last attributed
// function paths per image. Text is loaded only for each selected comparison.
func verifyRealDisassembly(t *testing.T, s *store.Store, h http.Handler, revision, root, reportID string) {
	t.Helper()
	type function struct {
		Function wire.NativeFunction `json:"function"`
		Text     string              `json:"text"`
	}
	type selected struct {
		Ordinal int
		Entry   function
		Image   string
	}
	expected := map[string][]selected{}
	file, err := os.Open(filepath.Join(root, "native-code.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	decoder := json.NewDecoder(file)
	token, err := decoder.Token()
	if err != nil || token != json.Delim('{') {
		t.Fatal("native archive header", err)
	}
	codePass, codeSeal, version := "", "", ""
	for decoder.More() {
		token, err = decoder.Token()
		if err != nil {
			t.Fatal(err)
		}
		key := token.(string)
		if key == "run" || key == "source_checksums_sha256" || key == "version" {
			var value string
			if err = decoder.Decode(&value); err != nil {
				t.Fatal(err)
			}
			switch key {
			case "run":
				codePass = value
			case "source_checksums_sha256":
				codeSeal = value
			case "version":
				version = value
			}
			continue
		}
		if key != "records" {
			var skip json.RawMessage
			if err = decoder.Decode(&skip); err != nil {
				t.Fatal(err)
			}
			continue
		}
		token, err = decoder.Token()
		if err != nil || token != json.Delim('[') {
			t.Fatal(err)
		}
		for decoder.More() {
			var record struct {
				Trial string `json:"trial"`
				Image *struct {
					SHA256 string `json:"sha256"`
				} `json:"image"`
				Disassembly *struct {
					Functions []function `json:"functions"`
				} `json:"disassembly"`
			}
			if err = decoder.Decode(&record); err != nil {
				t.Fatal(err)
			}
			if record.Image == nil || record.Disassembly == nil || len(record.Disassembly.Functions) == 0 {
				continue
			}
			n := len(record.Disassembly.Functions)
			seen := map[int]bool{}
			for _, ordinal := range []int{0, n / 2, n - 1} {
				if !seen[ordinal] {
					seen[ordinal] = true
					expected[record.Trial] = append(expected[record.Trial], selected{ordinal, record.Disassembly.Functions[ordinal], record.Image.SHA256})
				}
			}
		}
		if _, err = decoder.Token(); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = decoder.Token(); err != nil {
		t.Fatal(err)
	}
	if version != "native-image-disassembly-v3" || codePass == "" || !wire.IsHash(codeSeal) || len(expected) == 0 {
		t.Fatal("native archive identities missing")
	}
	seal, err := os.ReadFile(filepath.Join(root, "checksums.json"))
	if err != nil {
		t.Fatal(err)
	}
	nativeSeal := wire.Hash(seal)
	records, err := s.Catalog(revision, "artifact")
	if err != nil {
		t.Fatal(err)
	}
	images, functions := 0, 0
	for _, record := range records {
		artifact, err := wire.ArtifactData(record.Data)
		if err != nil {
			t.Fatal(err)
		}
		if artifact.ReportID != reportID {
			continue
		}
		selections, ok := expected[artifact.Record.Trial]
		if !ok {
			continue
		}
		if artifact.Inspection.Disassembly == nil || artifact.Inspection.Disassembly.Status != "available" {
			t.Fatal("real native derivative unavailable")
		}
		images++
		for _, selection := range selections {
			original, err := os.ReadFile(filepath.Join(root, selection.Entry.Text))
			if err != nil {
				t.Fatal(err)
			}
			base := fmt.Sprintf("/api/v1/artifacts/%s/disassembly?revision=%s&function=%d&limit=100", record.ID, revision, selection.Ordinal)
			cursor := ""
			joined := strings.Builder{}
			offset := 0
			for requests := 0; requests < 10000; requests++ {
				path := base
				if cursor != "" {
					path += "&cursor=" + url.QueryEscape(cursor)
				}
				response := realFixtureGET(t, h, path)
				if response.Code != 200 || response.Body.Len() > wire.ResponseBytes {
					t.Fatal("real disassembly HTTP", response.Code, response.Body.Len())
				}
				var page struct {
					Window     store.DisassemblyPage `json:"window"`
					NextCursor string                `json:"nextCursor"`
					Complete   bool                  `json:"complete"`
					Offset     int                   `json:"offset"`
				}
				if err = json.Unmarshal(response.Body.Bytes(), &page); err != nil {
					t.Fatal(err)
				}
				source := page.Window.Source
				if source == nil || source.Location != "external-archive" || source.CodePassID != codePass || source.CodeSealSHA256 != codeSeal || source.NativeSealSHA256 != nativeSeal || source.Verification != "producer-asserted" || page.Window.SourceVersion != version || page.Window.ImageSHA256 != selection.Image || page.Window.TextSHA256 != wire.Hash(original) || page.Offset != offset {
					t.Fatal("real derivative source identity drift")
				}
				function := page.Window.Function
				function.Disassembly = ""
				if function != selection.Entry.Function {
					t.Fatal("real native function mapping drift")
				}
				for _, line := range page.Window.Items {
					joined.WriteString(line)
				}
				offset += len(page.Window.Items)
				if page.Complete {
					if offset != page.Window.Total || page.NextCursor != "" {
						t.Fatal("incomplete native listing")
					}
					break
				}
				if page.NextCursor == "" || page.NextCursor == cursor || requests == 9999 {
					t.Fatal("real listing pagination did not terminate")
				}
				cursor = page.NextCursor
			}
			if joined.String() != string(original) {
				t.Fatal("original LLVM diagnostic changed")
			}
			functions++
		}
		if images%25 == 0 {
			t.Logf("verified real disassembly images=%d selected-functions=%d", images, functions)
		}
	}
	if images != len(expected) {
		t.Fatal("real native image population disappeared", images, len(expected))
	}
	t.Logf("real native disassembly HTTP parity: images=%d selected-functions=%d; exact source seals, range identities, original text and cursors preserved", images, functions)
}
