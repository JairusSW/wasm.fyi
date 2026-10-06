package store

import (
	"context"
	"errors"
	"sort"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

var ErrProgressChanged = errors.New("live progress changed; restart pagination")

type ProgressScope struct{ Session, Machine, Corpus, Status string }
type ProgressPage struct {
	Root        string
	Items       []AttemptProgress
	Total, Next int
}

func (s *Store) ProgressPage(ctx context.Context, scope ProgressScope, expectedRoot string, offset, limit int) (ProgressPage, error) {
	out := ProgressPage{Items: []AttemptProgress{}}
	if !wire.IsIdentity(scope.Session) || scope.Machine != "" && !wire.IsIdentity(scope.Machine) || scope.Corpus != "" && !wire.IsIdentity(scope.Corpus) || offset < 0 || limit < 1 || limit > 100 {
		return out, wire.Invalid("invalid progress scope or page")
	}
	if offset > 0 && expectedRoot == "" {
		return out, wire.Invalid("progress continuation requires a generation")
	}
	if scope.Status != "" && scope.Status != "running" && scope.Status != "completed" && scope.Status != "interrupted" && scope.Status != "failed" {
		return out, wire.Invalid("invalid progress status filter")
	}
	if e := s.publish.LockContext(ctx); e != nil {
		return out, e
	}
	defer s.publish.Unlock()
	p, e := s.registered(scope.Session)
	if e != nil {
		return out, e
	}
	if p.Progress != nil {
		out.Root = p.Progress.Root
	}
	if expectedRoot != "" && expectedRoot != out.Root {
		return out, ErrProgressChanged
	}
	if p.Progress == nil {
		if offset != 0 {
			return out, wire.Invalid("invalid progress offset")
		}
		return out, nil
	}
	if !wire.IsHash(out.Root) || p.Progress.Count < 1 || p.Progress.Count > ProgressLimit {
		return out, wire.Invalid("invalid progress index")
	}
	type ref struct {
		key, id string
		names   []string
	}
	refs := []ref{}
	budget := ScanLimit
	decoded := 0
	seen := 0
	e = s.walk(out.Root, &budget, func(key, id string) error {
		if e := ctx.Err(); e != nil {
			return e
		}
		seen++
		var names []string
		if e := wire.Decode([]byte(key), &names); e != nil {
			return e
		}
		if len(names) != 3 || !wire.IsIdentity(names[0]) || !wire.IsIdentity(names[1]) || !wire.IsIdentity(names[2]) {
			return wire.Invalid("invalid progress key")
		}
		if scope.Machine != "" && scope.Machine != names[0] || scope.Corpus != "" && scope.Corpus != names[1] {
			return nil
		}
		if scope.Status != "" {
			var state AttemptProgress
			b, e := s.typedContent(id, &state)
			if e != nil {
				return e
			}
			decoded += len(b)
			if decoded > 32<<20 {
				return ErrLimit
			}
			if e = wire.Decode(b, &state); e != nil {
				return e
			}
			if e = validateProgress(state); e != nil {
				return e
			}
			if progressKey(state.Update) != key || state.Update.Session != scope.Session || state.Update.Plan != p.Registration.Plan {
				return wire.Invalid("progress binding differs")
			}
			if state.Update.Status != scope.Status {
				return nil
			}
		}
		refs = append(refs, ref{key, id, names})
		return nil
	})
	if e != nil {
		return out, e
	}
	if seen != p.Progress.Count {
		return out, wire.Invalid("progress count differs")
	}
	sort.Slice(refs, func(i, j int) bool {
		for k := 0; k < 3; k++ {
			if refs[i].names[k] != refs[j].names[k] {
				return refs[i].names[k] < refs[j].names[k]
			}
		}
		return false
	})
	out.Total = len(refs)
	if offset > out.Total {
		return out, wire.Invalid("invalid progress offset")
	}
	end := min(out.Total, offset+limit)
	for _, r := range refs[offset:end] {
		if e = ctx.Err(); e != nil {
			return out, e
		}
		var state AttemptProgress
		if e = s.load(r.id, &state); e != nil {
			return out, e
		}
		if e = validateProgress(state); e != nil {
			return out, e
		}
		if progressKey(state.Update) != r.key || state.Update.Session != scope.Session || state.Update.Plan != p.Registration.Plan {
			return out, wire.Invalid("progress binding differs")
		}
		out.Items = append(out.Items, state)
	}
	out.Next = end
	return out, nil
}
