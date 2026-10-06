package store

import (
	"context"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

type RevisionPage struct {
	Items  []string
	Next   string
	Total  int
	Offset int
}

// RevisionPageContext reads at most limit parent links. The starting revision
// and signed successor retain the original chain after newer publication.
func (s *Store) RevisionPageContext(ctx context.Context, anchor, next string, offset, limit int) (RevisionPage, error) {
	out := RevisionPage{Items: []string{}}
	if err := ctx.Err(); err != nil {
		return out, err
	}
	if !wire.IsHash(anchor) || limit < 1 || limit > 1000 || offset < 0 {
		return out, wire.Invalid("invalid revision page scope")
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	root, ok := s.published[anchor]
	if !ok {
		return out, ErrNotFound
	}
	out.Total = root.ordinal
	if next == "" {
		if offset != 0 {
			return out, wire.Invalid("revision successor required")
		}
		next = anchor
	}
	current, ok := s.published[next]
	if !ok || current.ordinal < 1 || root.ordinal-current.ordinal != offset {
		return out, wire.Invalid("revision cursor outside scope")
	}
	for next != "" && len(out.Items) < limit {
		if err := ctx.Err(); err != nil {
			return RevisionPage{}, err
		}
		record, ok := s.published[next]
		if !ok {
			return RevisionPage{}, ErrNotFound
		}
		out.Items = append(out.Items, next)
		next = record.Parent
	}
	out.Next = next
	out.Offset = offset + len(out.Items)
	return out, nil
}
