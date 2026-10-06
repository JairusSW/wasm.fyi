package store

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func TestBackupCopyBufferReusePreservesDetachedBytesAndCancellation(t *testing.T) {
	source := t.TempDir()
	destination := t.TempDir()
	root, err := os.OpenRoot(source)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	buffer := make([]byte, 128*1024)
	contents := map[string][]byte{"large": bytes.Repeat([]byte("large-block\n"), 30000), "small": []byte("ok"), "empty": {}}
	for _, name := range []string{"large", "small", "empty"} {
		data := contents[name]
		if err := os.WriteFile(filepath.Join(source, name), data, 0600); err != nil {
			t.Fatal(err)
		}
		record, err := copyRegular(context.Background(), root, name, filepath.Join(destination, name), int64(len(data)), buffer)
		if err != nil || record.Bytes != int64(len(data)) || record.SHA256 != wire.Hash(data) {
			t.Fatal("reused buffer mixed file bytes", name, record, err)
		}
		if err := os.WriteFile(filepath.Join(source, name), []byte("changed"), 0600); err != nil {
			t.Fatal(err)
		}
		copied, err := os.ReadFile(filepath.Join(destination, name))
		if err != nil || !bytes.Equal(copied, data) {
			t.Fatal("backup shares mutable source bytes", name, err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	path := filepath.Join(destination, "canceled")
	if _, err := copyRegular(ctx, root, "small", path, 32, buffer); !errors.Is(err, context.Canceled) {
		t.Fatal("copy ignored pre-read cancellation", err)
	}
	if _, err := os.Lstat(path); !os.IsNotExist(err) {
		t.Fatal("canceled copy created destination", err)
	}
	if _, err := copyRegular(context.Background(), root, "small", path, 32, nil); err == nil {
		t.Fatal("empty buffer allowed non-progressing copy")
	}
}
