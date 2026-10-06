package store

// A content-addressed radix map. Leaves contain at most 32 entries, branch
// nodes at most 16 children. Updating a job copies only affected paths.
import (
	"encoding/json"
	"fmt"
	"sort"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

type node struct {
	Entries  map[string]string `json:"entries,omitempty"`
	Children map[string]string `json:"children,omitempty"`
}

func (s *Store) put(v any) (string, error) {
	b, e := wire.Encode(v)
	if e != nil {
		return "", e
	}
	if len(b) > wire.ChunkBytes {
		return "", fmt.Errorf("index object exceeds ceiling")
	}
	id := wire.Hash(b)
	return id, s.installBytes(id, b)
}
func (s *Store) load(id string, v any) error {
	b, e := s.typedContent(id, v)
	if e != nil {
		return e
	}
	return json.Unmarshal(b, v)
}
func (s *Store) mapGet(root, key string) (string, error) {
	path := wire.Hash([]byte(key))
	for depth := 0; root != ""; depth++ {
		var n node
		if e := s.load(root, &n); e != nil {
			return "", e
		}
		if n.Children == nil {
			return n.Entries[key], nil
		}
		if depth >= len(path) {
			return "", fmt.Errorf("map depth exceeds hash width")
		}
		root = n.Children[path[depth:depth+1]]
	}
	return "", nil
}
func (s *Store) mapSet(root, key, value string, depth int) (string, error) {
	n := node{Entries: map[string]string{}}
	if root != "" {
		if e := s.load(root, &n); e != nil {
			return "", e
		}
	}
	if n.Children != nil {
		path := wire.Hash([]byte(key))
		if depth >= len(path) {
			return "", fmt.Errorf("map collision")
		}
		prefix := path[depth : depth+1]
		child, e := s.mapSet(n.Children[prefix], key, value, depth+1)
		if e != nil {
			return "", e
		}
		if child == n.Children[prefix] {
			return root, nil
		}
		n.Children[prefix] = child
		return s.put(n)
	}
	if n.Entries[key] == value {
		return root, nil
	}
	n.Entries[key] = value
	if len(n.Entries) <= 32 {
		return s.put(n)
	}
	if depth >= 64 {
		return "", fmt.Errorf("map collision")
	}
	children := map[string]string{}
	keys := make([]string, 0, len(n.Entries))
	for k := range n.Entries {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		path := wire.Hash([]byte(k))
		prefix := path[depth : depth+1]
		child, e := s.mapSet(children[prefix], k, n.Entries[k], depth+1)
		if e != nil {
			return "", e
		}
		children[prefix] = child
	}
	return s.put(node{Children: children})
}
func (s *Store) walk(root string, budget *int, visit func(string, string) error) error {
	if root == "" {
		return nil
	}
	*budget--
	if *budget < 0 {
		return ErrLimit
	}
	var n node
	if e := s.load(root, &n); e != nil {
		return e
	}
	keys := []string{}
	if n.Children != nil {
		for k := range n.Children {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			if e := s.walk(n.Children[k], budget, visit); e != nil {
				return e
			}
		}
	} else {
		for k := range n.Entries {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			*budget--
			if *budget < 0 {
				return ErrLimit
			}
			if e := visit(k, n.Entries[k]); e != nil {
				return e
			}
		}
	}
	return nil
}
