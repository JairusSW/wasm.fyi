package store

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func syncDir(path string) error {
	f, e := os.Open(path)
	if e != nil {
		return e
	}
	defer f.Close()
	return f.Sync()
}

// Install writes a private temporary file, syncs it, then installs by full hash.
// Existing objects are checked and never mutated through shared hardlinks.
func (s *Store) Install(id string, r io.Reader) error {
	if !wire.IsHash(id) {
		return fmt.Errorf("invalid digest")
	}
	b, e := io.ReadAll(io.LimitReader(r, wire.ChunkBytes+1))
	if e != nil {
		return e
	}
	if len(b) > wire.ChunkBytes || wire.Hash(b) != id {
		return fmt.Errorf("content digest or size mismatch")
	}
	return s.installBytes(id, b)
}
func (s *Store) installBytes(id string, b []byte) error {
	path := filepath.Join(s.root, "objects", id)
	if old, e := os.ReadFile(path); e == nil {
		if !bytes.Equal(old, b) {
			return fmt.Errorf("corrupt existing content")
		}
		return nil
	} else if !os.IsNotExist(e) {
		return e
	}
	f, e := os.CreateTemp(filepath.Dir(path), ".install-")
	if e != nil {
		return e
	}
	defer os.Remove(f.Name())
	if _, e = f.Write(b); e != nil {
		f.Close()
		return e
	}
	if e = f.Sync(); e != nil {
		f.Close()
		return e
	}
	if e = f.Close(); e != nil {
		return e
	}
	if e = os.Rename(f.Name(), path); e != nil {
		return e
	}
	return syncDir(filepath.Dir(path))
}
func (s *Store) content(id string) ([]byte, error) {
	if !wire.IsHash(id) {
		return nil, ErrNotFound
	}
	b, e := os.ReadFile(filepath.Join(s.root, "objects", id))
	if e != nil {
		return nil, e
	}
	if len(b) > wire.ChunkBytes || wire.Hash(b) != id {
		return nil, fmt.Errorf("corrupt content %s", id)
	}
	return b, nil
}
