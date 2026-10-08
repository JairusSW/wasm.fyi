package store

import (
	"context"
	"sort"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

const SessionIndexVersion = "published-session-jobs-v1"

type PublishedJob struct {
	ID                   string    `json:"id"`
	Kind                 string    `json:"kind,omitempty"`
	Session              string    `json:"session"`
	Machine              string    `json:"machine"`
	Corpus               string    `json:"corpus"`
	Attempt              string    `json:"attempt"`
	Plan                 string    `json:"plan"`
	ConfiguredHarnessPin string    `json:"configuredHarnessPin,omitempty"`
	ParentBundleSHA256   string    `json:"parentBundleSha256,omitempty"`
	ParentArchiveStored  bool      `json:"parentArchiveStored,omitempty"`
	CollectionStatus     string    `json:"collectionStatus"`
	PublicationStatus    string    `json:"publicationStatus"`
	PublishedAt          time.Time `json:"publishedAt"`
	Reports              []string  `json:"reports"`
	HistoryBindings      int       `json:"historyBindings,omitempty"`
	HistoryCoverage      int       `json:"historyCoverage,omitempty"`
}
type Session struct {
	ID                   string `json:"id"`
	Revision             string `json:"revision"`
	Plan                 string `json:"plan"`
	ConfiguredHarnessPin string `json:"configuredHarnessPin"`
	PublishedJobs        int    `json:"publishedJobs"`
	PublishedCorpusJobs  int    `json:"publishedCorpusJobs"`
	Members              int    `json:"members"`
	PlannedJobs          *int   `json:"plannedJobs"`
	CollectionComplete   *bool  `json:"collectionComplete"`
	CompletenessReason   string `json:"completenessReason"`
}
type JobPage struct {
	Items       []PublishedJob `json:"items"`
	Total, Next int
}

func jobSummary(job wire.Job, id string, created time.Time) PublishedJob {
	out := PublishedJob{ID: id, Session: job.Session, Machine: job.Machine, Corpus: job.Corpus, Attempt: job.Attempt, Plan: job.Plan, ConfiguredHarnessPin: job.ConfiguredHarnessPin, ParentBundleSHA256: job.ParentBundleSHA256, CollectionStatus: job.Status, PublicationStatus: "published", PublishedAt: created, Reports: []string{}}
	out.Kind = job.Kind
	out.ParentArchiveStored = job.ParentArchive != nil
	out.HistoryBindings = len(job.History)
	out.HistoryCoverage = len(job.HistoryCoverage)
	for _, export := range job.Exports {
		if export.Manifest.Format != "site-v2" && export.Manifest.Format != "site-v2-retained" {
			continue
		}
		out.Reports = append(out.Reports, export.Manifest.ReportID)
	}
	sort.Strings(out.Reports)
	return out
}
func publishedJobKey(j PublishedJob) string {
	b, _ := wire.Encode([]string{j.Machine, j.Corpus, j.Attempt, j.ID})
	return string(b)
}

func (s *Store) indexPublishedJobs(ctx context.Context, rev *Revision, job wire.Job) error {
	if e := s.indexSessionPlan(ctx, rev, job); e != nil {
		return e
	}
	updates := map[string]map[string]string{}
	add := func(j wire.Job, id string, created time.Time) error {
		if e := ctx.Err(); e != nil {
			return e
		}
		summary := jobSummary(j, id, created)
		digest, e := s.put(summary)
		if e != nil {
			return e
		}
		rev.Indexes, e = s.indexAdd(rev.Indexes, indexKey("published-job", "", ""), id, digest)
		if e != nil {
			return e
		}
		if updates[j.Session] == nil {
			updates[j.Session] = map[string]string{}
		}
		updates[j.Session][publishedJobKey(summary)] = digest
		return nil
	}
	if rev.SessionIndexVersion == "" {
		decoded, count := 0, 0
		for id := rev.Parent; id != ""; {
			if e := ctx.Err(); e != nil {
				return e
			}
			count++
			if count > ScanLimit {
				return ErrLimit
			}
			parent, e := s.Revision(id)
			if e != nil {
				return e
			}
			b, e := s.jobContent(parent.Job)
			if e != nil {
				return e
			}
			decoded += len(b)
			if decoded > 32<<20 {
				return ErrLimit
			}
			var j wire.Job
			if e = wire.Decode(b, &j); e != nil {
				return e
			}
			if e = add(j, parent.Job, parent.Created); e != nil {
				return e
			}
			id = parent.Parent
		}
	} else if rev.SessionIndexVersion != SessionIndexVersion {
		return wire.Invalid("unsupported session index")
	}
	if e := add(job, rev.Job, rev.Created); e != nil {
		return e
	}
	directory := map[string]string{}
	sessions := []string{}
	for session := range updates {
		sessions = append(sessions, session)
	}
	sort.Strings(sessions)
	for _, session := range sessions {
		k := indexKey("session-jobs", session, "")
		set, e := s.indexGet(rev.Indexes, k)
		if e != nil {
			return e
		}
		for key := range updates[session] {
			old, e := s.mapGet(set.Root, key)
			if e != nil {
				return e
			}
			if old == "" {
				set.Count++
			}
		}
		set.Root, e = s.mapSetMany(ctx, set.Root, updates[session], 0)
		if e != nil {
			return e
		}
		id, e := s.put(set)
		if e != nil {
			return e
		}
		directory[k] = id
	}
	root, e := s.mapSetMany(ctx, rev.Indexes, directory, 0)
	if e != nil {
		return e
	}
	rev.Indexes = root
	rev.SessionIndexVersion = SessionIndexVersion
	return nil
}

func (s *Store) sessionReferences(ctx context.Context, revision, session string) (Revision, map[string]string, error) {
	if revision == "" {
		revision = s.Current()
	}
	rev, e := s.Revision(revision)
	if e != nil {
		return rev, nil, e
	}
	if !wire.IsIdentity(session) {
		return rev, nil, wire.Invalid("invalid session identity")
	}
	refs := map[string]string{}
	budget := ScanLimit
	if rev.SessionIndexVersion == SessionIndexVersion {
		set, e := s.indexGet(rev.Indexes, indexKey("session-jobs", session, ""))
		if e != nil {
			return rev, nil, e
		}
		e = s.walk(set.Root, &budget, func(key, id string) error {
			if e := ctx.Err(); e != nil {
				return e
			}
			refs[key] = id
			return nil
		})
		if e != nil {
			return rev, nil, e
		}
	} else if rev.SessionIndexVersion == "" {
		decoded := 0
		for id := revision; id != ""; {
			if e := ctx.Err(); e != nil {
				return rev, nil, e
			}
			budget--
			if budget < 0 {
				return rev, nil, ErrLimit
			}
			r, e := s.Revision(id)
			if e != nil {
				return rev, nil, e
			}
			b, e := s.jobContent(r.Job)
			if e != nil {
				return rev, nil, e
			}
			decoded += len(b)
			if decoded > 32<<20 {
				return rev, nil, ErrLimit
			}
			var j wire.Job
			if e = wire.Decode(b, &j); e != nil {
				return rev, nil, e
			}
			if j.Session == session {
				summary := jobSummary(j, r.Job, r.Created)
				b, _ := wire.Encode(summary)
				refs[publishedJobKey(summary)] = string(b)
			}
			id = r.Parent
		}
	} else {
		return rev, nil, wire.Invalid("unsupported session index")
	}
	if len(refs) == 0 {
		return rev, nil, ErrNotFound
	}
	return rev, refs, nil
}
func (s *Store) publishedSummary(rev Revision, id string) (PublishedJob, error) {
	var summary PublishedJob
	if rev.SessionIndexVersion == SessionIndexVersion {
		e := s.load(id, &summary)
		return summary, e
	}
	e := wire.Decode([]byte(id), &summary)
	return summary, e
}
func (s *Store) SessionJobs(ctx context.Context, revision, session string, offset, limit int) (JobPage, error) {
	out := JobPage{Items: []PublishedJob{}}
	if offset < 0 || limit < 1 || limit > 1000 {
		return out, wire.Invalid("invalid page bounds")
	}
	rev, refs, e := s.sessionReferences(ctx, revision, session)
	if e != nil {
		return out, e
	}
	keys := []string{}
	for k := range refs {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out.Total = len(keys)
	out.Next = offset
	if offset > len(keys) {
		return out, wire.Invalid("invalid page offset")
	}
	size := 2048
	for out.Next < len(keys) && len(out.Items) < limit {
		if e := ctx.Err(); e != nil {
			return out, e
		}
		summary, e := s.publishedSummary(rev, refs[keys[out.Next]])
		if e != nil {
			return out, e
		}
		if summary.Session != session || publishedJobKey(summary) != keys[out.Next] {
			return out, wire.Invalid("corrupt session job reference")
		}
		b, _ := wire.Encode(summary)
		if size+len(b)+1 > wire.ResponseBytes {
			break
		}
		size += len(b) + 1
		out.Items = append(out.Items, summary)
		out.Next++
	}
	return out, nil
}
func (s *Store) SessionInfo(ctx context.Context, revision, session string) (Session, error) {
	if revision == "" {
		revision = s.Current()
	}
	out := Session{ID: session, Revision: revision, CompletenessReason: "only completed collection jobs are submitted; full session plan is not indexed"}
	rev, refs, e := s.sessionReferences(ctx, revision, session)
	if e != nil {
		return out, e
	}
	scope, e := s.sessionPlanScope(ctx, rev, session)
	if e != nil {
		return out, e
	}
	members := map[string]bool{}
	// Publications identify attempts; retries can belong to the same corpus job.
	corpusJobs := map[struct{ machine, corpus string }]bool{}
	decoded := 0
	for key, id := range refs {
		if e := ctx.Err(); e != nil {
			return out, e
		}
		summary, e := s.publishedSummary(rev, id)
		if e != nil {
			return out, e
		}
		b, _ := wire.Encode(summary)
		decoded += len(b)
		if decoded > 32<<20 {
			return out, ErrLimit
		}
		if summary.Session != session || publishedJobKey(summary) != key {
			return out, wire.Invalid("corrupt session summary")
		}
		if out.Plan != "" && (out.Plan != summary.Plan || out.ConfiguredHarnessPin != summary.ConfiguredHarnessPin) {
			return out, wire.Invalid("session immutable bindings differ")
		}
		out.Plan, out.ConfiguredHarnessPin = summary.Plan, summary.ConfiguredHarnessPin
		if scope != nil {
			contains, e := scope.Contains(summary.Machine, summary.Corpus)
			if e != nil {
				return out, e
			}
			if scope.Plan != summary.Plan || scope.ConfiguredHarnessPin != summary.ConfiguredHarnessPin || !contains {
				return out, wire.Invalid("published job outside session plan")
			}
		}
		members[summary.Machine] = true
		corpusJobs[struct{ machine, corpus string }{summary.Machine, summary.Corpus}] = true
		out.PublishedJobs++
	}
	out.Members = len(members)
	out.PublishedCorpusJobs = len(corpusJobs)
	if scope != nil {
		planned := scope.MemberCount * scope.CorpusCount
		complete := planned == out.PublishedCorpusJobs
		out.PlannedJobs, out.CollectionComplete = &planned, &complete
		out.CompletenessReason = "published completed attempts cover only part of the immutable session plan"
		if complete {
			out.CompletenessReason = "every planned machine/corpus job has a published completed attempt; outcomes may include failures or unsupported measurements"
		}
	}
	return out, nil
}
