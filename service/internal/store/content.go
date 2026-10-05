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

// Open beneath an OS-confined root, reject symlinks/non-files, and compare the
// opened inode to the lstat result so a path swap cannot escape the validation.
func (s *Store) openObject(id string) (*os.File, error) {
	if !wire.IsHash(id) {
		return nil, wire.Invalid("invalid digest")
	}
	info, e := s.objects.Lstat(id)
	if e != nil {
		return nil, e
	}
	if !info.Mode().IsRegular() || info.Size() > wire.ChunkBytes {
		return nil, fmt.Errorf("invalid content object %s", id)
	}
	f, e := s.objects.Open(id)
	if e != nil {
		return nil, e
	}
	opened, e := f.Stat()
	if e != nil {
		f.Close()
		return nil, e
	}
	if !os.SameFile(info, opened) || !opened.Mode().IsRegular() || opened.Size() > wire.ChunkBytes {
		f.Close()
		return nil, fmt.Errorf("content object changed while opening")
	}
	return f, nil
}
func (s *Store) Install(id string, r io.Reader) error {
	if !wire.IsHash(id) {
		return wire.Invalid("invalid digest")
	}
	b, e := io.ReadAll(io.LimitReader(r, wire.ChunkBytes+1))
	if e != nil {
		return e
	}
	if len(b) > wire.ChunkBytes || wire.Hash(b) != id {
		return wire.Invalid("content digest or size mismatch")
	}
	return s.installBytes(id, b)
}
func (s *Store) installBytes(id string, b []byte) error {
	if !wire.IsHash(id) || len(b) > wire.ChunkBytes || wire.Hash(b) != id {
		return wire.Invalid("invalid content")
	}
	if old, e := s.content(id); e == nil {
		if !bytes.Equal(old, b) {
			return fmt.Errorf("corrupt existing content")
		}
		// An earlier directory-sync error must not turn a retry into an assertion
		// that an existing filename is durable without syncing it again.
		f, e := s.openObject(id)
		if e != nil {
			return e
		}
		e = f.Sync()
		eClose := f.Close()
		if e != nil {
			return e
		}
		if eClose != nil {
			return eClose
		}
		return syncDir(filepath.Join(s.root, "objects"))
	} else if !os.IsNotExist(e) {
		return e
	}
	directory := filepath.Join(s.root, "objects")
	f, e := os.CreateTemp(directory, ".install-")
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
	// Link installs without replacing any existing inode, including a symlink.
	// Concurrent deliveries of identical bytes reuse the winning installation.
	if e = os.Link(f.Name(), filepath.Join(directory, id)); e != nil {
		if !os.IsExist(e) {
			return e
		}
		existing, e := s.content(id)
		if e != nil {
			return e
		}
		if !bytes.Equal(existing, b) {
			return fmt.Errorf("conflicting content installation")
		}
	}
	if e = os.Remove(f.Name()); e != nil {
		return e
	}
	return syncDir(directory)
}
func (s *Store) content(id string) ([]byte, error) {
	if !wire.IsHash(id) {
		return nil, ErrNotFound
	}
	f, e := s.openObject(id)
	if e != nil {
		return nil, e
	}
	defer f.Close()
	b, e := io.ReadAll(io.LimitReader(f, wire.ChunkBytes+1))
	if e != nil {
		return nil, e
	}
	if len(b) > wire.ChunkBytes || wire.Hash(b) != id {
		return nil, fmt.Errorf("corrupt content %s", id)
	}
	return b, nil
}
