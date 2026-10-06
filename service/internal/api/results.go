package api

import (
	"context"
	"net/http"
	"sync"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

const resultCacheBytes = 16 << 20
const resultCacheEntries = 24

type resultCacheEntry struct {
	rows []wire.Record
	cost int
}
type resultCache struct {
	hits, misses, rejected, evictions uint64
	mu                                sync.Mutex
	entries                           map[string]resultCacheEntry
	order                             []string
	bytes                             int
}

func (c *resultCache) get(key string) ([]wire.Record, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[key]
	if ok {
		c.hits++
	} else {
		c.misses++
	}
	return entry.rows, ok
}
func (c *resultCache) put(key string, rows []wire.Record) {
	cost := 128 + len(key)
	for _, r := range rows {
		cost += 2*(len(r.Data)+len(r.ID)+len(r.Kind)) + 192
	}
	if cost > resultCacheBytes {
		c.mu.Lock()
		c.rejected++
		c.mu.Unlock()
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.entries[key]; ok {
		return
	}
	for len(c.order) >= resultCacheEntries || c.bytes+cost > resultCacheBytes {
		c.evictions++
		old := c.order[0]
		c.order = c.order[1:]
		c.bytes -= c.entries[old].cost
		delete(c.entries, old)
	}
	c.entries[key] = resultCacheEntry{rows, cost}
	c.order = append(c.order, key)
	c.bytes += cost
}

func (a *API) resultRows(ctx context.Context, q store.Query, historical bool) ([]wire.Record, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	// Limit is a pagination/cursor contract; global selection and ordering do not
	// depend on it. Share the same sorted result set across page sizes.
	keyQuery := q
	keyQuery.Limit = 0
	b, _ := wire.Encode(keyQuery)
	prefix := "results:"
	if historical {
		prefix = "history:"
	}
	key := wire.Hash(append([]byte(prefix), b...))
	if rows, ok := a.results.get(key); ok {
		return rows, nil
	}
	select {
	case a.selecting <- struct{}{}:
		defer func() { <-a.selecting }()
	default:
		return nil, errQueryBusy
	}
	rows, err := a.Store.ResultsContext(ctx, q, historical)
	if err != nil {
		return nil, err
	}
	for i := range rows {
		if err = ctx.Err(); err != nil {
			return nil, err
		}
		var result wire.Result
		if err = wire.Decode(rows[i].Data, &result); err != nil {
			return nil, err
		}
		result.MeasurementMethod = nil
		result.Evidence = nil
		rows[i].Data, err = wire.Encode(result)
		if err != nil {
			return nil, err
		}
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	a.results.put(key, rows)
	return rows, nil
}

// No complete result-set serialization or decoding occurs to build a page.
func (a *API) resultPage(w http.ResponseWriter, r *http.Request, revision, query string, rows []wire.Record, n int, c cursor, immutable bool) {
	if err := r.Context().Err(); err != nil {
		problem(w, r, err)
		return
	}
	if c.Revision != "" && (c.Revision != revision || c.Query != query) {
		problem(w, r, wire.Invalid("cursor scope differs"))
		return
	}
	if c.Offset > len(rows) {
		problem(w, r, wire.Invalid("cursor offset invalid"))
		return
	}
	end := c.Offset
	size := 4096 // bounded envelope and signed cursor reserve
	for end < len(rows) && end-c.Offset < n {
		if err := r.Context().Err(); err != nil {
			problem(w, r, err)
			return
		}
		b, err := wire.Encode(rows[end])
		if err != nil {
			problem(w, r, err)
			return
		}
		if size+len(b)+1 > wire.ResponseBytes {
			break
		}
		size += len(b) + 1
		end++
	}
	if end == c.Offset && end < len(rows) {
		problem(w, r, store.ErrLimit)
		return
	}
	next := ""
	if end < len(rows) {
		next = a.sign(cursor{revision, query, end})
	}
	respond(w, r, 200, map[string]any{"revision": revision, "items": rows[c.Offset:end], "nextCursor": next, "complete": end == len(rows), "total": len(rows)}, immutable)
}
