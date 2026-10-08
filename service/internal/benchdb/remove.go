package benchdb

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"github.com/cockroachdb/pebble/v2"
)

// RemoveEngine atomically removes an engine's current and historical measurements.
// Other engines and shared metadata remain intact; outstanding cursors expire.
func (s *Store) RemoveEngine(ctx context.Context, id string) (int, error) {
	return s.removeMeasurements(ctx, id, false)
}

// RemovePlatform removes an obsolete platform and its measurements while
// preserving metadata and measurements shared with other platforms.
func (s *Store) RemovePlatform(ctx context.Context, id string) (int, error) {
	return s.removeMeasurements(ctx, id, true)
}

func (s *Store) removeMeasurements(ctx context.Context, id string, byPlatform bool) (int, error) {
	s.write.Lock()
	defer s.write.Unlock()
	b := s.db.NewIndexedBatch()
	defer b.Close()
	if byPlatform {
		if _, err := get(b, "platforms/"+id); errors.Is(err, pebble.ErrNotFound) {
			return 0, nil
		} else if err != nil {
			return 0, err
		}
	}
	removed := 0
	platforms := map[string]bool{}
	for _, prefix := range []string{"rows/", "history/"} {
		it, err := s.db.NewIter(&pebble.IterOptions{LowerBound: []byte(prefix), UpperBound: prefixEnd(prefix)})
		if err != nil {
			return 0, err
		}
		for it.First(); it.Valid(); it.Next() {
			if err = ctx.Err(); err != nil {
				it.Close()
				return 0, err
			}
			var m measurement
			if err = json.Unmarshal(it.Value(), &m); err != nil {
				it.Close()
				return 0, err
			}
			parts := strings.SplitN(string(it.Key()), "/", 4)
			if byPlatform {
				if parts[1] != id {
					continue
				}
			} else {
				raw, err := get(b, "engines/"+m.Engine)
				if err != nil {
					it.Close()
					return 0, err
				}
				var engine engine
				if err = json.Unmarshal(raw, &engine); err != nil {
					it.Close()
					return 0, err
				}
				if engine.ID != id {
					continue
				}
			}
			platforms[parts[1]] = true
			counter := "count/"
			if prefix == "history/" {
				counter = "historycount/"
			}
			n, err := count(b, counter+parts[1]+"/"+parts[2])
			if err != nil {
				it.Close()
				return 0, err
			}
			if err = setCount(b, counter+parts[1]+"/"+parts[2], n-1); err != nil {
				it.Close()
				return 0, err
			}
			for _, ref := range []struct{ kind, id string }{{"contracts", m.Contract}, {"engines", m.Engine}} {
				if err = adjustReference(b, ref.kind, ref.id, -1); err != nil {
					it.Close()
					return 0, err
				}
			}
			if err = b.Delete(append([]byte(nil), it.Key()...), nil); err != nil {
				it.Close()
				return 0, err
			}
			removed++
		}
		err = it.Error()
		it.Close()
		if err != nil {
			return 0, err
		}
	}
	if removed == 0 && !byPlatform {
		return 0, nil
	}
	rows, err := count(b, "meta/rows")
	if err != nil {
		return 0, err
	}
	if err = setCount(b, "meta/rows", rows-removed); err != nil {
		return 0, err
	}
	if byPlatform {
		if err = b.Delete([]byte("platforms/"+id), nil); err != nil {
			return 0, err
		}
		n, err := count(b, "meta/platforms")
		if err != nil {
			return 0, err
		}
		if err = setCount(b, "meta/platforms", n-1); err != nil {
			return 0, err
		}
	}
	for platform := range platforms {
		old, err := get(b, "revision/"+platform)
		if err != nil {
			return 0, err
		}
		if err = b.Set([]byte("revision/"+platform), []byte(wire.Hash(append(old, []byte("remove:"+id)...))), nil); err != nil {
			return 0, err
		}
	}
	old, err := get(b, "meta/revision")
	if err != nil {
		return 0, err
	}
	if err = b.Set([]byte("meta/revision"), []byte(wire.Hash(append(old, []byte("remove:"+id)...))), nil); err != nil {
		return 0, err
	}
	if err = ctx.Err(); err != nil {
		return 0, err
	}
	return removed, b.Commit(pebble.Sync)
}
