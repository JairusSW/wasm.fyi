package store

import (
	"context"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func (s *Store) sessionPlanScope(ctx context.Context, rev Revision, session string) (*wire.PlanScope, error) {
	set, e := s.indexGet(rev.Indexes, indexKey("session-plan", "", ""))
	if e != nil {
		return nil, e
	}
	id, e := s.mapGet(set.Root, session)
	if e != nil || id == "" {
		return nil, e
	}
	published, e := s.indexGet(rev.Indexes, indexKey("published-job", "", ""))
	if e != nil {
		return nil, e
	}
	summaryID, e := s.mapGet(published.Root, id)
	if e != nil {
		return nil, e
	}
	if summaryID == "" {
		return nil, wire.Invalid("session plan source is not published in this revision")
	}
	var summary PublishedJob
	if e := s.load(summaryID, &summary); e != nil {
		return nil, e
	}
	if summary.ID != id || summary.Session != session {
		return nil, wire.Invalid("session plan publication reference differs")
	}
	var source wire.Job
	if e = s.load(id, &source); e != nil {
		return nil, e
	}
	if source.Session != session || source.SessionPlan == nil || summary.Plan != source.Plan || summary.ConfiguredHarnessPin != source.ConfiguredHarnessPin {
		return nil, wire.Invalid("session plan reference differs")
	}
	scope, e := source.SessionPlan.Verify(source, func(o wire.Object) ([]byte, error) {
		if e := ctx.Err(); e != nil {
			return nil, e
		}
		return s.objectRepresentation(o)
	})
	if e != nil {
		return nil, e
	}
	return &scope, nil
}

func (s *Store) indexSessionPlan(ctx context.Context, rev *Revision, job wire.Job) error {
	scope, e := s.sessionPlanScope(ctx, *rev, job.Session)
	if e != nil {
		return e
	}
	hadScope := scope != nil
	if job.SessionPlan != nil {
		verified, e := job.SessionPlan.Verify(job, func(o wire.Object) ([]byte, error) {
			if e := ctx.Err(); e != nil {
				return nil, e
			}
			return s.objectRepresentation(o)
		})
		if e != nil {
			return e
		}
		scope = &verified
	}
	if scope == nil {
		return nil
	}
	if scope.Plan != job.Plan || scope.ConfiguredHarnessPin != job.ConfiguredHarnessPin || !scope.Contains(job.Machine, job.Corpus) {
		return wire.Invalid("job outside registered session plan")
	}
	// Attaching plan content to a legacy session must account for its already
	// published jobs; no out-of-plan delivery may become a completion claim.
	if !hadScope && rev.Parent != "" {
		old, refs, e := s.sessionReferences(ctx, rev.Parent, job.Session)
		if e != nil && e != ErrNotFound {
			return e
		}
		decoded := 0
		for key, id := range refs {
			if e := ctx.Err(); e != nil {
				return e
			}
			summary, e := s.publishedSummary(old, id)
			if e != nil {
				return e
			}
			b, _ := wire.Encode(summary)
			decoded += len(b)
			if decoded > 32<<20 {
				return ErrLimit
			}
			if summary.Session != job.Session || publishedJobKey(summary) != key || !scope.Contains(summary.Machine, summary.Corpus) {
				return wire.Invalid("published job outside session plan")
			}
		}
	}
	if job.SessionPlan != nil {
		rev.Indexes, e = s.indexAdd(rev.Indexes, indexKey("session-plan", "", ""), job.Session, rev.Job)
	}
	return e
}
