package store

import (
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

type publicationOrigin struct {
	rank    int
	created time.Time
}

func (s *Store) publicationOrigins(read func(string, any) error) (map[string]publicationOrigin, map[string]int, error) {
	jobs := map[string]publicationOrigin{}
	revisions := map[string]int{}
	for id := s.Current(); id != ""; {
		if _, ok := revisions[id]; ok {
			return nil, nil, wire.Invalid("publication ancestry cycle")
		}
		if len(revisions) >= 1000000 {
			return nil, nil, ErrLimit
		}
		var rev Revision
		if e := read(id, &rev); e != nil {
			return nil, nil, e
		}
		if !wire.IsHash(rev.Job) {
			return nil, nil, wire.Invalid("invalid canonical published job")
		}
		if _, ok := jobs[rev.Job]; ok {
			return nil, nil, wire.Invalid("duplicate canonical job publication")
		}
		rank := len(revisions)
		revisions[id] = rank
		jobs[rev.Job] = publicationOrigin{rank: rank, created: rev.Created}
		id = rev.Parent
	}
	if len(revisions) != len(s.Revisions()) {
		return nil, nil, wire.Invalid("unreachable publication revision")
	}
	return jobs, revisions, nil
}

// Persistent posting trees are shared across revisions. Cache the newest origin
// rank of each node, rather than walking every historical posting in every view.
// Validation of the timestamp and publishing origin is independent of the view;
// comparison of that node's rank is repeated for each frozen revision.
type publicationPostingInfo struct{ newest, height int }
type publicationPostingVerifier struct {
	read    func(string, any) error
	origins map[string]publicationOrigin
	nodes   map[string]publicationPostingInfo
	active  map[string]bool
}

func (v *publicationPostingVerifier) newest(root string) (int, error) {
	info, e := v.inspect(root, 0, false)
	return info.newest, e
}
func (v *publicationPostingVerifier) newestDirectory(root string) (int, error) {
	info, e := v.inspect(root, 0, true)
	return info.newest, e
}
func (v *publicationPostingVerifier) inspect(root string, depth int, directory bool) (publicationPostingInfo, error) {
	empty := publicationPostingInfo{newest: len(v.origins)}
	if depth > 64 {
		return empty, wire.Invalid("publication posting exceeds radix depth")
	}
	if root == "" {
		return empty, nil
	}
	cacheKey := root
	if directory {
		cacheKey = "directory:" + root
	}
	if info, ok := v.nodes[cacheKey]; ok {
		if depth+info.height > 64 {
			return empty, wire.Invalid("publication posting exceeds radix depth")
		}
		return info, nil
	}
	if v.active[root] {
		return empty, wire.Invalid("publication posting cycle")
	}
	if v.active == nil {
		v.active = map[string]bool{}
	}
	v.active[root] = true
	defer delete(v.active, root)
	var n node
	if e := v.read(root, &n); e != nil {
		return empty, e
	}
	if e := validateNode(n); e != nil {
		return empty, e
	}
	info := empty
	for _, child := range n.Children {
		childInfo, e := v.inspect(child, depth+1, directory)
		if e != nil {
			return empty, e
		}
		info.newest = min(info.newest, childInfo.newest)
		info.height = max(info.height, childInfo.height+1)
	}
	for key, id := range n.Entries {
		if directory {
			var tuple []string
			if e := wire.Decode([]byte(key), &tuple); e != nil {
				return empty, e
			}
			if len(tuple) != 3 {
				return empty, wire.Invalid("invalid publication index tuple")
			}
			if tuple[0] != "session-jobs" && tuple[0] != "published-job" {
				continue
			}
			var set indexSet
			if e := v.read(id, &set); e != nil {
				return empty, e
			}
			rank, e := v.newest(set.Root)
			if e != nil {
				return empty, e
			}
			info.newest = min(info.newest, rank)
			continue
		}
		var summary PublishedJob
		if e := v.read(id, &summary); e != nil {
			return empty, e
		}
		origin, ok := v.origins[summary.ID]
		if !ok || !summary.PublishedAt.Equal(origin.created) {
			return empty, wire.Invalid("job posting has no matching publication origin")
		}
		info.newest = min(info.newest, origin.rank)
	}
	if v.nodes == nil {
		v.nodes = map[string]publicationPostingInfo{}
	}
	v.nodes[cacheKey] = info
	return info, nil
}
