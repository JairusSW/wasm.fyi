package sqldb

import (
	"context"
	"fmt"
	"strings"
)

// SetMetadata preserves opaque metadata bytes. Migration uses a legacy/ prefix
// so historical store internals cannot replace SQL cursor keys or revisions.
func (s *Store) SetMetadata(ctx context.Context, key string, value []byte) error {
	if key == "" || len(key) > 4096 {
		return fmt.Errorf("invalid metadata key")
	}
	s.write.Lock()
	defer s.write.Unlock()
	_, e := s.writer.ExecContext(ctx, "INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", key, value)
	return e
}
func (s *Store) ExportMetadata(ctx context.Context, emit func(string, []byte) error) error {
	rows, e := s.reader.QueryContext(ctx, "SELECT key,value FROM metadata WHERE key LIKE 'legacy/%' ORDER BY key")
	if e != nil {
		return e
	}
	defer rows.Close()
	for rows.Next() {
		var key string
		var value []byte
		if e = rows.Scan(&key, &value); e != nil {
			return e
		}
		if e = emit(strings.TrimPrefix(key, "legacy/"), value); e != nil {
			return e
		}
	}
	return rows.Err()
}
