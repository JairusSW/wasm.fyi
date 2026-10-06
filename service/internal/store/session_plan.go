package store

import (
	"context"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

// Fixed-size metadata references persistent membership pages. Full source plan
// content is verified during publication and portable/startup validation.
type indexedPlanScope struct {
	Schema               int      `json:"schema"`
	Session              string   `json:"session"`
	Plan                 string   `json:"plan"`
	ConfiguredHarnessPin string   `json:"configuredHarnessPin"`
	SourceJob            string   `json:"sourceJob"`
	Members              indexSet `json:"members"`
	Corpora              indexSet `json:"corpora"`
}
type sessionScope struct {
	Plan, ConfiguredHarnessPin, SourceJob string
	MemberCount, CorpusCount              int
	contains                              func(string, string) (bool, error)
	indexed                               *indexedPlanScope
	verified                              *wire.PlanScope
}

func (p sessionScope) Contains(machine, corpus string) (bool, error) {
	return p.contains(machine, corpus)
}
func memorySessionScope(scope wire.PlanScope, source string) *sessionScope {
	return &sessionScope{Plan: scope.Plan, ConfiguredHarnessPin: scope.ConfiguredHarnessPin, SourceJob: source, MemberCount: len(scope.Members), CorpusCount: len(scope.Corpora), verified: &scope, contains: func(m, c string) (bool, error) { return scope.Contains(m, c), nil }}
}
func (s *Store) planPublication(rev Revision, session, id string) (PublishedJob, error) {
	var summary PublishedJob
	published, e := s.indexGet(rev.Indexes, indexKey("published-job", "", ""))
	if e != nil {
		return summary, e
	}
	summaryID, e := s.mapGet(published.Root, id)
	if e != nil {
		return summary, e
	}
	if summaryID == "" {
		return summary, wire.Invalid("session plan source is not published in this revision")
	}
	if e := s.load(summaryID, &summary); e != nil {
		return summary, e
	}
	if summary.ID != id || summary.Session != session {
		return summary, wire.Invalid("session plan publication reference differs")
	}
	return summary, nil
}
func (s *Store) sessionPlanScope(ctx context.Context, rev Revision, session string) (*sessionScope, error) {
	return s.sessionPlanScopeWithVerifier(ctx, rev, session, nil)
}
func (s *Store) sessionPlanScopeWithVerifier(ctx context.Context, rev Revision, session string, verifier *planVerifier) (*sessionScope, error) {
	if e := ctx.Err(); e != nil {
		return nil, e
	}
	set, e := s.indexGet(rev.Indexes, indexKey("session-plan-scope", "", ""))
	if e != nil {
		return nil, e
	}
	projection, e := s.mapGet(set.Root, session)
	if e != nil {
		return nil, e
	}
	if projection != "" {
		var p indexedPlanScope
		if e := s.load(projection, &p); e != nil {
			return nil, e
		}
		if p.Schema != 1 || p.Session != session || !wire.IsHash(p.Plan) || !wire.IsHash(p.SourceJob) || !wire.IsHash(p.Members.Root) || !wire.IsHash(p.Corpora.Root) || p.Members.Count < 1 || p.Members.Count > 128 || p.Corpora.Count < 1 || p.Corpora.Count > 10000 || p.Members.Count*p.Corpora.Count > ScanLimit {
			return nil, wire.Invalid("invalid session plan scope index")
		}
		summary, e := s.planPublication(rev, session, p.SourceJob)
		if e != nil {
			return nil, e
		}
		if summary.Plan != p.Plan || summary.ConfiguredHarnessPin != p.ConfiguredHarnessPin {
			return nil, wire.Invalid("session plan scope binding differs")
		}
		return &sessionScope{Plan: p.Plan, ConfiguredHarnessPin: p.ConfiguredHarnessPin, SourceJob: p.SourceJob, MemberCount: p.Members.Count, CorpusCount: p.Corpora.Count, indexed: &p, contains: func(m, c string) (bool, error) {
			if e := ctx.Err(); e != nil {
				return false, e
			}
			member, e := s.mapGet(p.Members.Root, m)
			if e != nil || member != "1" {
				return false, e
			}
			corpus, e := s.mapGet(p.Corpora.Root, c)
			return corpus == "1", e
		}}, nil
	}
	// Compatibility: immutable revisions created before the membership projection
	// still verify the original plan on demand. The next publication indexes it.
	set, e = s.indexGet(rev.Indexes, indexKey("session-plan", "", ""))
	if e != nil {
		return nil, e
	}
	id, e := s.mapGet(set.Root, session)
	if e != nil || id == "" {
		return nil, e
	}
	summary, e := s.planPublication(rev, session, id)
	if e != nil {
		return nil, e
	}
	var source wire.Job
	if e = s.load(id, &source); e != nil {
		return nil, e
	}
	if source.Session != session || source.SessionPlan == nil || summary.Plan != source.Plan || summary.ConfiguredHarnessPin != source.ConfiguredHarnessPin {
		return nil, wire.Invalid("session plan reference differs")
	}
	var scope wire.PlanScope
	if verifier != nil {
		scope, e = verifier.verify(source)
	} else {
		scope, e = source.SessionPlan.Verify(source, func(o wire.Object) ([]byte, error) {
			if e := ctx.Err(); e != nil {
				return nil, e
			}
			return s.objectRepresentation(o)
		})
	}
	if e != nil {
		return nil, e
	}
	return memorySessionScope(scope, id), nil
}
func (s *Store) persistPlanScope(ctx context.Context, rev *Revision, session string, scope *sessionScope) error {
	if scope.indexed != nil {
		return nil
	}
	p := indexedPlanScope{Schema: 1, Session: session, Plan: scope.Plan, ConfiguredHarnessPin: scope.ConfiguredHarnessPin, SourceJob: scope.SourceJob}
	makeSet := func(values []string) (indexSet, error) {
		entries := map[string]string{}
		for _, v := range values {
			entries[v] = "1"
		}
		root, e := s.mapSetMany(ctx, "", entries, 0)
		return indexSet{Root: root, Count: len(entries)}, e
	}
	var e error
	if p.Members, e = makeSet(scope.verified.Members); e != nil {
		return e
	}
	if p.Corpora, e = makeSet(scope.verified.Corpora); e != nil {
		return e
	}
	id, e := s.put(p)
	if e != nil {
		return e
	}
	rev.Indexes, e = s.indexAdd(rev.Indexes, indexKey("session-plan-scope", "", ""), session, id)
	return e
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
		// Existing source identity fixes the complete scope. Reuse its projection.
		if scope == nil {
			scope = memorySessionScope(verified, rev.Job)
		}
	}
	if scope == nil {
		return nil
	}
	contains, e := scope.Contains(job.Machine, job.Corpus)
	if e != nil {
		return e
	}
	if scope.Plan != job.Plan || scope.ConfiguredHarnessPin != job.ConfiguredHarnessPin || !contains {
		return wire.Invalid("job outside registered session plan")
	}
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
			contains, e := scope.Contains(summary.Machine, summary.Corpus)
			if e != nil {
				return e
			}
			if summary.Session != job.Session || publishedJobKey(summary) != key || !contains {
				return wire.Invalid("published job outside session plan")
			}
		}
	}
	if e := s.persistPlanScope(ctx, rev, job.Session, scope); e != nil {
		return e
	}
	if job.SessionPlan != nil {
		rev.Indexes, e = s.indexAdd(rev.Indexes, indexKey("session-plan", "", ""), job.Session, rev.Job)
	}
	return e
}
