package store

import (
	"context"
	"fmt"
	"sort"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

type Page struct {
	Items []wire.Record
	Next  int
	Total int
}

// Catalog pages enumerate small IDs/references first, then open only the
// requested descriptors. A page of reports never decodes all report metadata.
func (s *Store) CatalogPage(ctx context.Context, revision, kind string, offset, limit int) (Page, error) {
	return s.catalogPage(ctx, revision, kind, indexKey("catalog", kind, ""), offset, limit)
}

func (s *Store) ConformancePage(ctx context.Context, revision, kind, source string, offset, limit int) (Page, error) {
	if _, err := s.Record(revision, "conformance-source", source); err != nil {
		return Page{}, err
	}
	return s.catalogPage(ctx, revision, kind, indexKey("source-"+kind, source, ""), offset, limit)
}

func (s *Store) HistoryCoveragePage(ctx context.Context, revision, scope string, offset, limit int) (Page, error) {
	if scope != "" && !wire.IsHash(scope) {
		return Page{}, wire.Invalid("invalid history coverage scope")
	}
	return s.catalogPage(ctx, revision, "history-coverage", indexKey("history-coverage", scope, ""), offset, limit)
}

func (s *Store) FeatureProbePage(ctx context.Context, revision, report string, offset, limit int) (Page, error) {
	if _, err := s.Record(revision, "report", report); err != nil {
		return Page{}, err
	}
	return s.catalogPage(ctx, revision, "feature-probe", indexKey("report-features", report, ""), offset, limit)
}

func (s *Store) catalogPage(ctx context.Context, revision, kind, scope string, offset, limit int) (Page, error) {
	page := Page{Items: []wire.Record{}}
	if offset < 0 || limit < 1 || limit > 1000 {
		return page, wire.Invalid("invalid page bounds")
	}
	rev, e := s.Revision(revision)
	if e != nil {
		return page, e
	}
	refs := map[string]string{}
	budget := ScanLimit
	if rev.Indexes != "" {
		set, e := s.indexGet(rev.Indexes, scope)
		if e != nil {
			return page, e
		}
		e = s.walk(set.Root, &budget, func(id, digest string) error {
			if e := ctx.Err(); e != nil {
				return e
			}
			refs[id] = digest
			return nil
		})
		if e != nil {
			return page, e
		}
	} else {
		if scope != indexKey("catalog", kind, "") {
			return page, wire.Invalid("feature scope requires indexed revision")
		}
		prefix := kind + ":"
		e = s.walk(rev.Catalog, &budget, func(k, digest string) error {
			if e := ctx.Err(); e != nil {
				return e
			}
			if len(k) > len(prefix) && k[:len(prefix)] == prefix {
				refs[k[len(prefix):]] = digest
			}
			return nil
		})
		if e != nil {
			return page, e
		}
	}
	ids := make([]string, 0, len(refs))
	for id := range refs {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	page.Total = len(ids)
	if offset > len(ids) {
		return page, wire.Invalid("invalid page offset")
	}
	page.Next = offset
	size := 2048
	for page.Next < len(ids) && len(page.Items) < limit {
		if e := ctx.Err(); e != nil {
			return page, e
		}
		id := ids[page.Next]
		b, e := s.content(refs[id])
		if e != nil {
			return page, e
		}
		if size+len(b)+1 > wire.ResponseBytes {
			break
		}
		var r wire.Record
		if e = wire.Decode(b, &r); e != nil {
			return page, e
		}
		identity := r.ID
		if kind == "history-coverage" && scope != indexKey("catalog", kind, "") {
			value, err := wire.HistoryCoverageData(r.Data)
			if err != nil {
				return page, err
			}
			identity = value.CoverageID
		}
		if identity != id || r.Kind != kind {
			return page, fmt.Errorf("corrupt catalog reference")
		}
		size += len(b) + 1
		page.Items = append(page.Items, r)
		page.Next++
	}
	if page.Next < len(ids) && len(page.Items) == 0 {
		return page, ErrLimit
	}
	return page, nil
}
