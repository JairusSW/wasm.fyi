package store

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestBatchMapsMatchCanonicalSequentialRootsWithoutIntermediateFiles(t *testing.T) {
	sequentialRoot, batchRoot := t.TempDir(), t.TempDir()
	s := openTest(t, sequentialRoot)
	defer s.Close()
	b := openTest(t, batchRoot)
	defer b.Close()
	updates := map[string]string{}
	root := ""
	for i := 0; i < 200; i++ {
		key := fmt.Sprintf("key-%04d", i)
		value := fmt.Sprintf("value-%04d", i)
		updates[key] = value
		var e error
		root, e = s.mapSet(root, key, value, 0)
		if e != nil {
			t.Fatal(e)
		}
	}
	batched, e := b.mapSetMany(context.Background(), "", updates, 0)
	if e != nil || root != batched {
		t.Fatal("canonical map shape changed", e)
	}
	files, _ := os.ReadDir(filepath.Join(sequentialRoot, "objects"))
	batchFiles, _ := os.ReadDir(filepath.Join(batchRoot, "objects"))
	if len(batchFiles)*4 >= len(files) {
		t.Fatal("intermediate index files retained", len(batchFiles), len(files))
	}
	old := batched
	updates = map[string]string{"key-0001": "changed", "new-key": "new-value"}
	for _, key := range []string{"key-0001", "new-key"} {
		root, e = s.mapSet(root, key, updates[key], 0)
		if e != nil {
			t.Fatal(e)
		}
	}
	batched, e = b.mapSetMany(context.Background(), batched, updates, 0)
	if e != nil || root != batched {
		t.Fatal("incremental canonical root drifted", e)
	}
	if value, e := b.mapGet(old, "key-0001"); e != nil || value != "value-0001" {
		t.Fatal("old map changed")
	}
	same, e := b.mapSetMany(context.Background(), batched, updates, 0)
	if e != nil || same != batched {
		t.Fatal("idempotent update copied unchanged branches")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, e = b.mapSetMany(ctx, batched, updates, 0); e != context.Canceled {
		t.Fatal("cancellation ignored")
	}
}
