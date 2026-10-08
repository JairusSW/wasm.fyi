package store

import (
	"container/list"
	"encoding/json"
	"maps"
)

// Membership selection and its metadata reads share one verified, bounded
// cache. The serving store retains no content bytes after the operation.
func (s *Store) queryStore() *Store { return s.queryStoreWithCacheBytes(queryNodeCacheBytes) }
func (s *Store) queryStoreWithCacheBytes(cacheBytes int) *Store {
	if s.queryReadView {
		return s
	}
	view := s.validationStore()
	view.queryReadView = true
	cache := &queryNodeCache{limit: cacheBytes}
	view.queryNodeReader = func(id string) (node, error) {
		return cache.read(id, func() ([]byte, error) { return view.typedContent(id, &node{}) })
	}
	return view
}

const queryNodeCacheBytes = 16 << 20

type queryNodeEntry struct {
	id    string
	value node
	cost  int
}
type queryNodeCache struct {
	limit   int
	entries map[string]*list.Element
	order   list.List
	bytes   int
}

func copyQueryNode(n node) node {
	return node{Entries: maps.Clone(n.Entries), Children: maps.Clone(n.Children)}
}
func (c *queryNodeCache) read(id string, fetch func() ([]byte, error)) (node, error) {
	if entry := c.entries[id]; entry != nil {
		c.order.MoveToFront(entry)
		return copyQueryNode(entry.Value.(queryNodeEntry).value), nil
	}
	body, err := fetch()
	if err != nil {
		return node{}, err
	}
	var value node
	if err = json.Unmarshal(body, &value); err != nil {
		return node{}, err
	}
	// Include map/entry overhead as well as the stored strings. The cache is
	// owned by one sequential query and never survives that query.
	cost := len(body) + 128*(len(value.Entries)+len(value.Children)) + 128
	limit := c.limit
	if limit == 0 {
		limit = queryNodeCacheBytes
	}
	if cost <= limit {
		if c.entries == nil {
			c.entries = map[string]*list.Element{}
		}
		c.entries[id] = c.order.PushFront(queryNodeEntry{id, value, cost})
		c.bytes += cost
		for c.bytes > limit {
			entry := c.order.Back()
			old := entry.Value.(queryNodeEntry)
			delete(c.entries, old.id)
			c.bytes -= old.cost
			c.order.Remove(entry)
		}
	}
	return copyQueryNode(value), nil
}
