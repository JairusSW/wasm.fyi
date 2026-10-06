package store

import (
	"context"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

type FunctionPage struct {
	Items       []wire.NativeFunction
	Total, Next int
	Indexed     bool
}

// FunctionPage reads only intersecting shards for indexed producer metadata.
// Legacy metadata is counted under the same explicit request work/byte limits.
func (s *Store) FunctionPage(ctx context.Context, revision, id string, offset, limit int) (FunctionPage, error) {
	page := FunctionPage{Items: []wire.NativeFunction{}}
	if offset < 0 || limit < 1 || limit > 1000 {
		return page, wire.Invalid("invalid function page")
	}
	record, err := s.Record(revision, "artifact", id)
	if err != nil {
		return page, err
	}
	artifact, err := wire.ArtifactData(record.Data)
	if err != nil {
		return page, err
	}
	if artifact.Inspection.Status != "available" {
		return page, ErrNotFound
	}
	decoded, reads := 0, 0
	fetch := func(digest string) ([]byte, error) {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		reads++
		if reads > ScanLimit {
			return nil, ErrLimit
		}
		b, err := s.content(digest)
		if err != nil {
			return nil, err
		}
		decoded += len(b)
		if decoded > 32<<20 {
			return nil, ErrLimit
		}
		return b, nil
	}
	b, err := fetch(artifact.Inspection.Metadata)
	if err != nil {
		return page, err
	}
	b, err = inspectionJSON(b, fetch)
	if err != nil {
		return page, err
	}
	var metadata wire.NativeMetadata
	if err = wire.Decode(b, &metadata); err != nil {
		return page, err
	}
	counts, err := metadata.FunctionCounts()
	if err != nil {
		return page, err
	}
	readShard := func(digest string) ([]wire.NativeFunction, error) {
		b, err := fetch(digest)
		if err != nil {
			return nil, err
		}
		b, err = inspectionJSON(b, fetch)
		if err != nil {
			return nil, err
		}
		var rows []wire.NativeFunction
		if err = wire.Decode(b, &rows); err != nil {
			return nil, err
		}
		reads += len(rows)
		if reads > ScanLimit {
			return nil, ErrLimit
		}
		return rows, nil
	}
	page.Indexed = counts != nil
	if counts == nil {
		counts = []int{}
		for _, digest := range metadata.Functions {
			rows, err := readShard(digest)
			if err != nil {
				return page, err
			}
			counts = append(counts, len(rows))
		}
	}
	for _, count := range counts {
		page.Total += count
	}
	if offset > page.Total {
		return page, wire.Invalid("function cursor offset invalid")
	}
	position, size := 0, 4096
	for i, digest := range metadata.Functions {
		if err = ctx.Err(); err != nil {
			return page, err
		}
		if position+counts[i] <= offset {
			position += counts[i]
			continue
		}
		if len(page.Items) >= limit {
			break
		}
		if counts[i] > ScanLimit-reads {
			return page, ErrLimit
		}
		rows, err := readShard(digest)
		if err != nil {
			return page, err
		}
		if len(rows) != counts[i] {
			return page, wire.Invalid("native function count differs")
		}
		for _, row := range rows {
			if position < offset {
				position++
				continue
			}
			b, err := wire.Encode(row)
			if err != nil {
				return page, err
			}
			if len(page.Items) >= limit || size+len(b)+1 > wire.ResponseBytes {
				if len(page.Items) == 0 {
					return page, ErrLimit
				}
				page.Next = offset + len(page.Items)
				return page, nil
			}
			size += len(b) + 1
			page.Items = append(page.Items, row)
			position++
		}
	}
	page.Next = offset + len(page.Items)
	return page, nil
}
