package api

import (
	"bytes"
	"encoding/json"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func TestNativeFunctionAPIFreezesArtifactScope(t *testing.T) {
	s, err := store.Open(t.TempDir(), "fixture")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	want := []wire.NativeFunction{}
	for i := 0; i < 7; i++ {
		want = append(want, wire.NativeFunction{WasmIndex: uint32(7 - i), Offset: uint64(i * 2), Length: 2, Tier: "cranelift"})
	}
	job, objects, artifact, err := testutil.FunctionFixture("api-functions", time.Now().UTC(), want, 2, true)
	if err != nil {
		t.Fatal(err)
	}
	id, err := s.Submit(job)
	if err != nil {
		t.Fatal(err)
	}
	for hash, data := range objects {
		if err = s.InstallDeclared(hash, bytes.NewReader(data)); err != nil {
			t.Fatal(err)
		}
	}
	rev, err := s.Commit(id)
	if err != nil {
		t.Fatal(err)
	}
	key, err := s.CursorKey()
	if err != nil {
		t.Fatal(err)
	}
	h, err := New(s, strings.Repeat("x", 32), key)
	if err != nil {
		t.Fatal(err)
	}
	path := "/api/v1/artifacts/" + artifact + "/functions"
	var page struct {
		Revision, Artifact, Order, NextCursor string
		Items                                 []wire.NativeFunction
		Total                                 int
		Complete, Indexed                     bool
	}
	w := request(t, h, "GET", path+"?revision="+rev+"&limit=3", nil, nil)
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &page) != nil || len(page.Items) != 3 || page.Total != 7 || !page.Indexed || page.Order != "producer-order" || page.NextCursor == "" {
		t.Fatal("first function page", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), `"image"`) || strings.Contains(w.Body.String(), `"references"`) || w.Body.Len() > 50*1024 {
		t.Fatal("function page preloaded other evidence")
	}
	firstCursor := page.NextCursor
	all := append([]wire.NativeFunction{}, page.Items...)
	importFixture(t, s, "new-publication", time.Now().UTC().Add(time.Hour))
	// Recreate the handler to exclude any dependence on in-memory iterator state.
	h, _ = New(s, strings.Repeat("x", 32), key)
	for page.NextCursor != "" {
		w = request(t, h, "GET", path+"?limit=3&cursor="+url.QueryEscape(page.NextCursor), nil, nil)
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &page) != nil || page.Revision != rev || page.Artifact != artifact || page.Total != 7 {
			t.Fatal("cursor publication drift", w.Code, w.Body.String())
		}
		all = append(all, page.Items...)
	}
	if !reflect.DeepEqual(all, want) || !page.Complete {
		t.Fatal("function attribution/order lost", all)
	}
	for _, query := range []string{"limit=4&cursor=" + url.QueryEscape(firstCursor), "revision=" + s.Current() + "&limit=3&cursor=" + url.QueryEscape(firstCursor), "limit=3&sort=offset", "limit=3&limit=3", "chunk=" + strings.Repeat("a", 64)} {
		if request(t, h, "GET", path+"?"+query, nil, nil).Code != 400 {
			t.Fatal("ambiguous function scope accepted", query)
		}
	}
	unknown := "/api/v1/artifacts/" + strings.Repeat("f", 64) + "/functions?revision=" + rev
	if request(t, h, "GET", unknown, nil, nil).Code != 404 {
		t.Fatal("unpublished function index exposed")
	}
}
