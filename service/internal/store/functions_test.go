package store

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func functionFixture(t *testing.T, s *Store, indexed bool) (string, string, []wire.NativeFunction, wire.NativeMetadata) {
	t.Helper()
	rows := []wire.NativeFunction{}
	for i := 0; i < 7; i++ {
		rows = append(rows, wire.NativeFunction{WasmIndex: uint32(7 - i), Offset: uint64(i * 2), Length: 2, Tier: "cranelift"})
	}
	job, objects, artifact, err := testutil.FunctionFixture("functions", time.Now().UTC(), rows, 2, indexed)
	if err != nil {
		t.Fatal(err)
	}
	for id, b := range objects {
		if err = s.Install(id, bytes.NewReader(b)); err != nil {
			t.Fatal(err)
		}
	}
	id, err := s.Submit(job)
	if err != nil {
		t.Fatal(err)
	}
	rev, err := s.Commit(id)
	if err != nil {
		t.Fatal(err)
	}
	record, err := s.Record(rev, "artifact", artifact)
	if err != nil {
		t.Fatal(err)
	}
	descriptor, err := wire.ArtifactData(record.Data)
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.content(descriptor.Inspection.Metadata)
	if err != nil {
		t.Fatal(err)
	}
	var metadata wire.NativeMetadata
	if err = json.Unmarshal(b, &metadata); err != nil {
		t.Fatal(err)
	}
	return rev, artifact, rows, metadata
}

func TestNativeFunctionPagesAndPortableRecovery(t *testing.T) {
	for _, indexed := range []bool{false, true} {
		t.Run(map[bool]string{false: "legacy", true: "indexed"}[indexed], func(t *testing.T) {
			s := openTest(t, filepath.Join(t.TempDir(), "live"))
			defer s.Close()
			rev, id, want, _ := functionFixture(t, s, indexed)
			check := func(s *Store) {
				all := []wire.NativeFunction{}
				offset := 0
				for {
					page, err := s.FunctionPage(context.Background(), rev, id, offset, 3)
					if err != nil || page.Total != len(want) || page.Indexed != indexed {
						t.Fatal("function page", page, err)
					}
					all = append(all, page.Items...)
					if page.Next == page.Total {
						break
					}
					offset = page.Next
				}
				if !reflect.DeepEqual(all, want) {
					t.Fatal("producer order changed", all)
				}
			}
			check(s)
			backup := filepath.Join(t.TempDir(), "backup")
			if _, err := s.Backup(context.Background(), backup); err != nil {
				t.Fatal(err)
			}
			rebuilt := filepath.Join(t.TempDir(), "rebuilt")
			if err := Rebuild(backup, rebuilt, "fixture"); err != nil {
				t.Fatal(err)
			}
			recovered := openTest(t, rebuilt)
			check(recovered)
			recovered.Close()
		})
	}
}

func TestIndexedFunctionPageSkipsUnselectedShards(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	rev, id, want, metadata := functionFixture(t, s, true)
	// After successful publication, temporarily remove the earlier shards. This
	// private test proves the selected later page does not read them or raw bytes.
	for _, ref := range metadata.Functions[:3] {
		if err := os.Remove(filepath.Join(s.root, "objects", ref)); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Remove(filepath.Join(s.root, "objects", wire.Hash(make([]byte, 64)))); err != nil {
		t.Fatal(err)
	}
	page, err := s.FunctionPage(context.Background(), rev, id, 6, 1)
	if err != nil || len(page.Items) != 1 || page.Items[0] != want[6] || page.Total != 7 {
		t.Fatal("unselected shard read", page, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = s.FunctionPage(ctx, rev, id, 6, 1); err == nil {
		t.Fatal("cancellation ignored")
	}
	if _, err = s.FunctionPage(context.Background(), rev, id, 8, 1); err == nil {
		t.Fatal("invalid offset accepted")
	}
}
