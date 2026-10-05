package store

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func openTest(t *testing.T, root string) *Store {
	t.Helper()
	s, e := Open(root, "fixture-publisher")
	if e != nil {
		t.Fatal(e)
	}
	return s
}
func stage(t *testing.T, s *Store, seed string, date time.Time) string {
	t.Helper()
	j, objects, e := testutil.Fixture(seed, date)
	if e != nil {
		t.Fatal(e)
	}
	for id, b := range objects {
		if e = s.Install(id, bytes.NewReader(b)); e != nil {
			t.Fatal(e)
		}
	}
	id, e := s.Submit(j)
	if e != nil {
		t.Fatal(e)
	}
	return id
}
func publishTest(t *testing.T, s *Store, seed string, date time.Time) string {
	t.Helper()
	id := stage(t, s, seed, date)
	rev, e := s.Commit(id)
	if e != nil {
		t.Fatal(e)
	}
	return rev
}
func TestRevisionsSelectionAndIdempotency(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	defer func() {
		if s != nil {
			s.Close()
		}
	}()
	date := time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC)
	old := publishTest(t, s, "first", date)
	current := publishTest(t, s, "second", date.Add(time.Hour))
	_ = publishTest(t, s, "backfill", date.Add(-time.Hour))
	for _, pair := range []struct {
		rev, selection string
		want           time.Time
	}{{old, "current", date}, {current, "current", date.Add(time.Hour)}, {s.Current(), "previous", date}} {
		rows, e := s.Results(Query{Revision: pair.rev, Selection: pair.selection}, false)
		if e != nil || len(rows) != 3 {
			t.Fatalf("rows=%d error=%v", len(rows), e)
		}
		for _, r := range rows {
			var v wire.Result
			_ = json.Unmarshal(r.Data, &v)
			if !v.Created.Equal(pair.want) {
				t.Fatalf("selection drift: %s", v.Created)
			}
		}
	}
	rows, e := s.Results(Query{Revision: s.Current()}, true)
	if e != nil || len(rows) != 9 {
		t.Fatalf("history=%d %v", len(rows), e)
	}
	duplicate := stage(t, s, "first", date)
	again, e := s.Commit(duplicate)
	if e != nil || again != old {
		t.Fatal("duplicate delivery created revision")
	}
	if e = s.Close(); e != nil {
		t.Fatal(e)
	}
	s = openTest(t, root)
	if s.Current() == "" {
		t.Fatal("lost durable pointer")
	}
	rows, e = s.Results(Query{Revision: old}, false)
	if e != nil || len(rows) != 3 {
		t.Fatal("lost retained revision")
	}
}
func TestFailureVisibilityAndRestart(t *testing.T) {
	for _, stageName := range []string{"files", "indexes", "before-commit", "after-commit"} {
		t.Run(stageName, func(t *testing.T) {
			root := t.TempDir()
			s := openTest(t, root)
			date := time.Now().UTC()
			old := publishTest(t, s, "first", date)
			id := stage(t, s, "second", date.Add(time.Hour))
			s.fail = func(stage string) error {
				if stage == stageName {
					return errors.New("injected crash")
				}
				return nil
			}
			if _, e := s.Commit(id); e == nil {
				t.Fatal("failure injection ignored")
			}
			if s.Current() != old {
				t.Fatal("partial revision visible")
			}
			rows, _ := s.Results(Query{Revision: old}, false)
			if len(rows) != 3 {
				t.Fatal("prior revision changed")
			}
			j, _ := s.Job(id)
			for _, x := range j.Exports {
				for _, o := range x.Manifest.Objects {
					if o.Kind != "record" {
						continue
					}
					b, _ := s.content(o.SHA256)
					var r wire.Record
					_ = json.Unmarshal(b, &r)
					if r.Kind == "result" {
						if _, e := s.Record(old, "result", r.ID); !errors.Is(e, ErrNotFound) {
							t.Fatal("staging ID leaked")
						}
					}
				}
			}
			if e := s.Close(); e != nil {
				t.Fatal(e)
			}
			s = openTest(t, root)
			defer s.Close()
			if stageName == "after-commit" {
				if s.Current() == old {
					t.Fatal("durable revision not recovered")
				}
			} else if s.Current() != old {
				t.Fatal("uncommitted revision recovered")
			}
			if _, e := s.Commit(id); e != nil {
				t.Fatal(e)
			}
		})
	}
}
func TestCorruptMissingAndIncompleteRejected(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	j, objects, e := testutil.Fixture("first", time.Now().UTC())
	if e != nil {
		t.Fatal(e)
	}
	j.Status = "interrupted"
	if _, e = s.Submit(j); e == nil {
		t.Fatal("incomplete job admitted")
	}
	j.Status = "completed"
	id, e := s.Submit(j)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.Commit(id); e == nil {
		t.Fatal("missing content published")
	}
	for digest, b := range objects {
		if e = s.Install(digest, bytes.NewReader(b)); e != nil {
			t.Fatal(e)
		}
	}
	for digest := range objects {
		if e = os.WriteFile(filepath.Join(s.root, "objects", digest), []byte("corrupt"), 0600); e != nil {
			t.Fatal(e)
		}
		break
	}
	if _, e = s.Commit(id); e == nil {
		t.Fatal("corrupt content published")
	}
	if s.Current() != "" {
		t.Fatal("failed import changed pointer")
	}
}
func TestPersistentMapSharingAndConcurrentDelivery(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	root := ""
	for i := 0; i < 100; i++ {
		k := wire.Hash([]byte{byte(i)})
		var e error
		root, e = s.mapSet(root, k, k, 0)
		if e != nil {
			t.Fatal(e)
		}
	}
	var before node
	if e := s.load(root, &before); e != nil {
		t.Fatal(e)
	}
	changed, e := s.mapSet(root, wire.Hash([]byte("new")), "value", 0)
	if e != nil {
		t.Fatal(e)
	}
	var after node
	_ = s.load(changed, &after)
	shared := 0
	for k, id := range before.Children {
		if after.Children[k] == id {
			shared++
		}
	}
	if shared < 10 {
		t.Fatalf("unchanged subtrees not shared: %d", shared)
	}
	id := stage(t, s, "concurrent", time.Now().UTC())
	var wg sync.WaitGroup
	revs := make(chan string, 8)
	errs := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Go(func() { rev, e := s.Commit(id); revs <- rev; errs <- e })
	}
	wg.Wait()
	close(revs)
	close(errs)
	first := ""
	for rev := range revs {
		if first == "" {
			first = rev
		}
		if rev != first {
			t.Fatal("duplicate revisions")
		}
	}
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
}
