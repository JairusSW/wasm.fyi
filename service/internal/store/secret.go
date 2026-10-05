package store

import (
	"crypto/rand"
	"fmt"
	"os"
	"path/filepath"
)

func (s *Store) CursorKey() ([]byte, error) {
	s.publish.Lock()
	defer s.publish.Unlock()
	if s.poisoned {
		return nil, ErrNeedsRestart
	}
	fs, e := os.OpenRoot(s.root)
	if e != nil {
		return nil, e
	}
	defer fs.Close()
	if info, e := fs.Lstat("cursor.key"); e == nil {
		if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Size() != 32 {
			return nil, fmt.Errorf("cursor secret must be a private 32-byte regular file")
		}
		return readRegular(fs, "cursor.key", 32)
	} else if !os.IsNotExist(e) {
		return nil, e
	}
	key := make([]byte, 32)
	if _, e = rand.Read(key); e != nil {
		return nil, e
	}
	if e = atomicFile(filepath.Join(s.root, "cursor.key"), key, 0600); e != nil {
		return nil, e
	}
	return key, nil
}
