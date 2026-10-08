package store

import (
	"container/list"
	"context"
	"fmt"
	"sync"
)

const validationCacheBytes = 16 << 20
const validationCacheEntryBytes = 16 << 10

type validationEntry struct {
	ID   string
	Data []byte
}
type validationCache struct {
	mu      sync.Mutex
	entries map[string]*list.Element
	order   list.List
	bytes   int
}

func (c *validationCache) read(ctx context.Context, id string, ceiling int, fetch func(context.Context, string, int) ([]byte, error)) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	c.mu.Lock()
	if entry := c.entries[id]; entry != nil {
		value := entry.Value.(validationEntry)
		if len(value.Data) > ceiling {
			c.mu.Unlock()
			return nil, fmt.Errorf("content exceeds decoded ceiling")
		}
		c.order.MoveToFront(entry)
		body := append([]byte{}, value.Data...)
		c.mu.Unlock()
		return body, nil
	}
	c.mu.Unlock()
	body, err := fetch(ctx, id, ceiling)
	if err != nil || len(body) > validationCacheEntryBytes {
		return body, err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.entries == nil {
		c.entries = map[string]*list.Element{}
	}
	if c.entries[id] == nil {
		data := append([]byte{}, body...)
		c.entries[id] = c.order.PushFront(validationEntry{id, data})
		c.bytes += len(data)
		for c.bytes > validationCacheBytes {
			entry := c.order.Back()
			value := entry.Value.(validationEntry)
			delete(c.entries, value.ID)
			c.bytes -= len(value.Data)
			c.order.Remove(entry)
		}
	}
	return body, nil
}

// Each reachability operation owns a read-only view and a bounded cache. The
// serving store never retains these bytes between requests or validation passes.
// Fetches delegate to the original confined reader, including its offline paths.
func (s *Store) validationStore() *Store {
	cache := &validationCache{}
	s.mu.RLock()
	reader := &Store{db: s.db, root: s.root, objects: s.objects, published: s.published, current: s.current, registrations: s.registrations, overviews: s.overviews, limits: s.limits, publisher: s.publisher}
	reader.preparedSelection = s.preparedSelection
	reader.queryWorkOwner = s
	if s.queryWorkOwner != nil {
		reader.queryWorkOwner = s.queryWorkOwner
	}
	s.mu.RUnlock()
	reader.validationReader = func(ctx context.Context, id string, ceiling int) ([]byte, error) {
		return cache.read(ctx, id, ceiling, s.representationContext)
	}
	return reader
}
