// Package store publishes immutable application revisions over Pebble and local
// content. The serving process owns the database; readers retain no snapshots.
package store

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"github.com/cockroachdb/pebble/v2"
)

var ErrNotFound = errors.New("resource not found in published revision")
var ErrLimit = errors.New("query exceeds scan or byte limit; narrow the scope")
var ErrNeedsRestart = errors.New("publication durability uncertain; restart service before another import")
var ErrConflict = errors.New("immutable session or attempt conflicts with existing delivery")

type Revision struct {
	Parent             string    `json:"parent,omitempty"`
	Catalog            string    `json:"catalogRoot"`
	Selection          string    `json:"selectionRoot"`
	Indexes            string    `json:"indexRoot,omitempty"`
	Job                string    `json:"job"`
	Publisher          string    `json:"trustedPublisher"`
	Created            time.Time `json:"publishedAt"`
	Integrity          string    `json:"byteIntegrity"`
	SourceVerification string    `json:"sourceVerification"`
	Qualification      string    `json:"operatorQualification"`
}
type Store struct {
	db           *pebble.DB
	root         string
	publish      sync.Mutex
	mu           sync.RWMutex
	published    map[string]Revision
	current      string
	publisher    string
	fail         func(string) error
	poisoned     atomic.Bool
	objects      *os.Root
	users        sync.RWMutex
	closed       bool
	limits       Limits
	contentMu    sync.Mutex
	contentBytes int64
}

// Key fields are length-prefixed, versioned tuples, never slash concatenation.
func key(fields ...string) []byte {
	out := []byte{1}
	for _, f := range fields {
		out = binary.BigEndian.AppendUint32(out, uint32(len(f)))
		out = append(out, f...)
	}
	return out
}
func Open(root, publisher string) (*Store, error) {
	return OpenWithLimits(root, publisher, DefaultLimits())
}
func OpenWithLimits(root, publisher string, limits Limits) (*Store, error) {
	if limits.PendingJobs < 1 || limits.PendingBytes < 1 || limits.ContentBytes < wire.ChunkBytes {
		return nil, wire.Invalid("invalid storage limits")
	}
	if publisher == "" {
		return nil, fmt.Errorf("publisher identity required")
	}
	if e := os.MkdirAll(filepath.Join(root, "objects"), 0700); e != nil {
		return nil, e
	}
	for _, path := range []string{root, filepath.Join(root, "objects")} {
		info, e := os.Lstat(path)
		if e != nil {
			return nil, e
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return nil, fmt.Errorf("data directory must be a real directory")
		}
	}
	if e := syncDir(root); e != nil {
		return nil, e
	}
	cache := pebble.NewCache(32 << 20)
	defer cache.Unref()
	db, e := pebble.Open(filepath.Join(root, "db"), &pebble.Options{Cache: cache, MemTableSize: 8 << 20, MemTableStopWritesThreshold: 2})
	if e != nil {
		return nil, e
	}
	objects, e := os.OpenRoot(filepath.Join(root, "objects"))
	if e != nil {
		db.Close()
		return nil, e
	}
	s := &Store{db: db, root: root, publisher: publisher, published: map[string]Revision{}, objects: objects, limits: limits}
	if e = s.scanContentUsage(); e != nil {
		db.Close()
		objects.Close()
		return nil, e
	}
	if e = s.restore(); e != nil {
		db.Close()
		objects.Close()
		return nil, e
	}
	if e = s.initializeAdmission(); e != nil {
		db.Close()
		objects.Close()
		return nil, e
	}
	return s, nil
}
func (s *Store) Close() error {
	s.users.Lock()
	defer s.users.Unlock()
	if s.closed {
		return nil
	}
	s.publish.Lock()
	defer s.publish.Unlock()
	s.closed = true
	return errors.Join(s.db.Close(), s.objects.Close())
}

// Lease lets server shutdown wait until every admitted handler has returned.
func (s *Store) Lease() (func(), error) {
	s.users.RLock()
	if s.closed {
		s.users.RUnlock()
		return nil, ErrNeedsRestart
	}
	return s.users.RUnlock, nil
}
func (s *Store) get(k []byte) ([]byte, error) {
	v, c, e := s.db.Get(k)
	if e != nil {
		return nil, e
	}
	b := append([]byte(nil), v...)
	return b, c.Close()
}
func (s *Store) restore() error {
	prefix := key("revision")
	it, e := s.db.NewIter(nil)
	if e != nil {
		return e
	}
	defer it.Close()
	for it.SeekGE(prefix); it.Valid() && bytes.HasPrefix(it.Key(), prefix); it.Next() {
		var r Revision
		if e = wire.Decode(it.Value(), &r); e != nil {
			return e
		}
		id := wire.Hash(it.Value())
		if !bytes.Equal(it.Key(), key("revision", id)) || !wire.IsHash(r.Catalog) || !wire.IsHash(r.Selection) || !wire.IsHash(r.Job) || r.Indexes != "" && !wire.IsHash(r.Indexes) || r.Parent != "" && !wire.IsHash(r.Parent) {
			return fmt.Errorf("invalid committed revision")
		}
		b, e := s.content(id)
		if e != nil {
			return e
		}
		if !bytes.Equal(b, it.Value()) {
			return fmt.Errorf("portable revision differs")
		}
		s.published[id] = r
	}
	if e = it.Error(); e != nil {
		return e
	}
	b, e := s.get(key("current"))
	if errors.Is(e, pebble.ErrNotFound) {
		if len(s.published) > 0 {
			return fmt.Errorf("revision registry has no active pointer")
		}
		return s.portable("")
	}
	if e != nil {
		return e
	}
	s.current = string(b)
	seen := map[string]bool{}
	for id := s.current; id != ""; {
		if seen[id] {
			return fmt.Errorf("revision parent cycle")
		}
		seen[id] = true
		r, ok := s.published[id]
		if !ok {
			return fmt.Errorf("active revision chain is incomplete")
		}
		id = r.Parent
	}
	if len(seen) != len(s.published) {
		return fmt.Errorf("unreachable committed revision")
	}
	// Shared persistent nodes are validated once across all retained revisions.
	if _, e = s.reachable(false); e != nil {
		return e
	}
	return s.portable(s.current)
}
func (s *Store) Current() string { s.mu.RLock(); defer s.mu.RUnlock(); return s.current }
func (s *Store) Revision(id string) (Revision, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if id == "" {
		id = s.current
	}
	r, ok := s.published[id]
	if !ok {
		return Revision{}, ErrNotFound
	}
	return r, nil
}
func (s *Store) Revisions() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	ids := make([]string, 0, len(s.published))
	for id := range s.published {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool {
		a, b := s.published[ids[i]], s.published[ids[j]]
		if a.Created.Equal(b.Created) {
			return ids[i] > ids[j]
		}
		return a.Created.After(b.Created)
	})
	return ids
}
func (s *Store) Submit(j wire.Job) (string, error) {
	s.publish.Lock()
	defer s.publish.Unlock()
	if s.poisoned.Load() {
		return "", ErrNeedsRestart
	}
	if e := j.Validate(); e != nil {
		return "", e
	}
	b, e := wire.Encode(j)
	if e != nil {
		return "", e
	}
	if len(b) > wire.ChunkBytes {
		return "", wire.Invalid("job manifest exceeds ceiling")
	}
	id := wire.Hash(b)
	if _, e = s.get(key("aborted", id)); e == nil {
		return "", ErrConflict
	} else if !errors.Is(e, pebble.ErrNotFound) {
		return "", e
	}
	if old, e := s.get(key("import", id)); e == nil {
		if !bytes.Equal(old, b) {
			return "", ErrConflict
		}
		return id, nil
	} else if !errors.Is(e, pebble.ErrNotFound) {
		return "", e
	}
	bindings := []struct{ key, value []byte }{
		{key("session", j.Session), mustEncode([]string{j.Plan, j.ConfiguredHarnessPin})},
		{key("member", j.Session, j.Machine), []byte(j.ParentBundleSHA256)},
		{key("attempt", j.Session, j.Machine, j.Corpus, j.Attempt), []byte(id)},
	}
	batch := s.db.NewBatch()
	defer batch.Close()
	if e = s.reserveImport(batch, id, j); e != nil {
		return "", e
	}
	for _, binding := range bindings {
		old, e := s.get(binding.key)
		if e == nil && string(old) != string(binding.value) {
			return "", ErrConflict
		}
		if e != nil && !errors.Is(e, pebble.ErrNotFound) {
			return "", e
		}
		if e = batch.Set(binding.key, binding.value, nil); e != nil {
			return "", e
		}
	}
	if e = batch.Set(key("import", id), b, nil); e != nil {
		return "", e
	}
	if e = batch.Commit(pebble.Sync); e != nil {
		s.poisoned.Store(true)
		return "", e
	}
	return id, nil
}
func mustEncode(v []string) []byte { b, _ := wire.Encode(v); return b }
func (s *Store) Job(id string) (wire.Job, error) {
	var j wire.Job
	if !wire.IsHash(id) {
		return j, ErrNotFound
	}
	b, e := s.get(key("import", id))
	if errors.Is(e, pebble.ErrNotFound) {
		return j, ErrNotFound
	}
	if e != nil {
		return j, e
	}
	e = json.Unmarshal(b, &j)
	return j, e
}
func (s *Store) Missing(id string) ([]wire.Object, error) {
	j, e := s.Job(id)
	if e != nil {
		return nil, e
	}
	out := []wire.Object{}
	seen := map[string]bool{}
	for _, x := range j.Exports {
		for _, o := range x.Manifest.Objects {
			if seen[o.SHA256] {
				continue
			}
			seen[o.SHA256] = true
			b, e := s.content(o.SHA256)
			if os.IsNotExist(e) {
				out = append(out, o)
			} else if e != nil {
				return nil, e
			} else if len(b) != o.Bytes {
				return nil, fmt.Errorf("object size differs")
			}
		}
	}
	return out, nil
}

type cell struct {
	Current  string `json:"current"`
	Previous string `json:"previous,omitempty"`
	History  string `json:"history"`
}
type history struct {
	Result   string `json:"result"`
	Previous string `json:"previous,omitempty"`
}

func (s *Store) checkpoint(stage string) error {
	if s.fail != nil {
		return s.fail(stage)
	}
	return nil
}
func (s *Store) Commit(id string) (string, error) {
	return s.CommitContext(context.Background(), id)
}
func (s *Store) CommitContext(ctx context.Context, id string) (string, error) {
	s.publish.Lock()
	defer s.publish.Unlock()
	if s.poisoned.Load() {
		return "", ErrNeedsRestart
	}
	if e := ctx.Err(); e != nil {
		return "", e
	}
	if _, e := s.get(key("aborted", id)); e == nil {
		return "", ErrConflict
	} else if !errors.Is(e, pebble.ErrNotFound) {
		return "", e
	}
	// A redelivery after any later publication resolves to the original revision.
	if b, e := s.get(key("accepted", id)); e == nil {
		return string(b), nil
	} else if !errors.Is(e, pebble.ErrNotFound) {
		return "", e
	}
	j, e := s.Job(id)
	if e != nil {
		return "", e
	}
	if e = j.Validate(); e != nil {
		return "", e
	}
	missing, e := s.Missing(id)
	if e != nil {
		return "", e
	}
	if len(missing) > 0 {
		return "", wire.Invalid(fmt.Sprintf("import missing %d objects", len(missing)))
	}
	records := map[string]wire.Record{}
	digests := map[string]string{}
	evidence := map[string]bool{}
	reportObjects := map[string]wire.Manifest{}
	for _, x := range j.Exports {
		if e := ctx.Err(); e != nil {
			return "", e
		}
		for _, o := range x.Manifest.Objects {
			if e := ctx.Err(); e != nil {
				return "", e
			}
			if o.Kind == "evidence" {
				evidence[o.SHA256] = true
				continue
			}
			b, e := s.content(o.SHA256)
			if e != nil {
				return "", e
			}
			var r wire.Record
			if e = wire.Decode(b, &r); e != nil {
				return "", e
			}
			if !wire.IsHash(r.ID) || len(r.Data) == 0 {
				return "", wire.Invalid("invalid record")
			}
			if r.Kind == "artifact" && len(r.Data)+512 > 10*1024 {
				return "", wire.Invalid("artifact descriptor exceeds budget")
			}
			switch r.Kind {
			case "environment", "configuration", "track", "workload", "metric", "result", "artifact":
				if wire.Hash(r.Data) != r.ID {
					return "", wire.Invalid("record identity mismatch")
				}
			case "report":
				if r.ID != x.Manifest.ReportID {
					return "", wire.Invalid("report identity mismatch")
				}
				var descriptor struct {
					Run    string `json:"runId"`
					Report string `json:"sourceReportSha256"`
					Seal   string `json:"sourceSealSha256"`
				}
				if e = json.Unmarshal(r.Data, &descriptor); e != nil {
					return "", e
				}
				identity, _ := wire.Encode([]string{descriptor.Run, descriptor.Report, descriptor.Seal})
				if wire.Hash(identity) != r.ID || descriptor.Report != x.Manifest.SourceReportSHA256 || descriptor.Seal != x.Manifest.SourceSealSHA256 {
					return "", wire.Invalid("source identities differ from manifest")
				}
				reportObjects[r.ID] = x.Manifest
			default:
				return "", wire.Invalid("unsupported record kind")
			}
			k := r.Kind + ":" + r.ID
			if d, ok := digests[k]; ok && d != o.SHA256 {
				return "", wire.Invalid("conflicting canonical record")
			}
			records[k] = r
			digests[k] = o.SHA256
		}
	}
	for _, x := range j.Exports {
		if _, ok := reportObjects[x.Manifest.ReportID]; !ok {
			return "", wire.Invalid("missing report descriptor")
		}
	}
	for _, r := range records {
		if r.Kind != "result" {
			continue
		}
		var v wire.Result
		if e = wire.Decode(r.Data, &v); e != nil {
			return "", e
		}
		if v.Runtime == "" || v.Workload == "" || v.Scenario == "" || v.Profile == "" || v.Metric == "" || v.Statistic == "" || v.AnalysisVersion == "" || v.Created.IsZero() || len(v.Summary) == 0 {
			return "", wire.Invalid("incomplete result identity")
		}
		for _, k := range []string{"report:" + v.ReportID, "environment:" + v.EnvironmentID, "configuration:" + v.ConfigurationID, "workload:" + v.ContractID, "track:" + v.TrackID, "metric:" + v.MetricDefinitionID} {
			if _, ok := records[k]; !ok {
				return "", wire.Invalid("unresolved result reference")
			}
		}
		for _, h := range v.Evidence {
			if !evidence[h] {
				return "", wire.Invalid("unresolved evidence reference")
			}
		}
		var configuration, workload struct {
			ID string `json:"id"`
		}
		if e = json.Unmarshal(records["configuration:"+v.ConfigurationID].Data, &configuration); e != nil {
			return "", e
		}
		if e = json.Unmarshal(records["workload:"+v.ContractID].Data, &workload); e != nil {
			return "", e
		}
		if configuration.ID != v.Runtime || workload.ID != v.Workload {
			return "", wire.Invalid("logical identity differs from exact record")
		}
		var summary struct {
			Artifact string `json:"artifactId"`
		}
		if e = json.Unmarshal(v.Summary, &summary); e != nil {
			return "", e
		}
		if summary.Artifact != "" {
			if _, ok := records["artifact:"+summary.Artifact]; !ok {
				return "", wire.Invalid("unresolved artifact reference")
			}
		}
	}
	// Report-level pass references are part of the export's integrity closure.
	for _, record := range records {
		if record.Kind != "report" {
			continue
		}
		var report struct {
			PassContexts []string `json:"passContexts"`
		}
		if e = json.Unmarshal(record.Data, &report); e != nil {
			return "", wire.Invalid("invalid pass contexts")
		}
		for _, ref := range report.PassContexts {
			if !evidence[ref] {
				return "", wire.Invalid("unresolved pass context")
			}
		}
	}
	// Evidence chunks may reference only declared evidence objects; never paths.
	for id := range evidence {
		b, e := s.content(id)
		if e != nil {
			return "", e
		}
		refs, e := wire.EvidenceReferences(b)
		if e != nil {
			return "", e
		}
		for _, ref := range refs {
			if !evidence[ref] {
				return "", wire.Invalid("unresolved evidence chunk")
			}
		}
	}
	if e = s.checkpoint("files"); e != nil {
		return "", e
	}
	parent := s.Current()
	rev := Revision{Parent: parent, Job: id, Publisher: s.publisher, Created: time.Now().UTC(), Integrity: "sha256-verified", SourceVerification: "producer-asserted", Qualification: "not-checked"}
	if parent != "" {
		old, e := s.Revision(parent)
		if e != nil {
			return "", e
		}
		rev.Catalog, rev.Selection, rev.Indexes = old.Catalog, old.Selection, old.Indexes
		if old.Indexes == "" {
			budget := 1000000
			if e = s.walk(old.Catalog, &budget, func(_, digest string) error {
				if e := ctx.Err(); e != nil {
					return e
				}
				var r wire.Record
				if e := s.load(digest, &r); e != nil {
					return e
				}
				return s.addRecordIndexes(&rev, r, digest)
			}); e != nil {
				return "", e
			}
		}
	}
	keys := make([]string, 0, len(records))
	for k := range records {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if e := ctx.Err(); e != nil {
			return "", e
		}
		existing, e := s.mapGet(rev.Catalog, k)
		if e != nil {
			return "", e
		}
		if existing != "" && existing != digests[k] {
			return "", wire.Invalid("immutable record collision")
		}
		rev.Catalog, e = s.mapSet(rev.Catalog, k, digests[k], 0)
		if e != nil {
			return "", e
		}
		if e = s.addRecordIndexes(&rev, records[k], digests[k]); e != nil {
			return "", e
		}
	}
	for _, k := range keys {
		if e := ctx.Err(); e != nil {
			return "", e
		}
		r := records[k]
		if r.Kind != "result" {
			continue
		}
		var v wire.Result
		if e = wire.Decode(r.Data, &v); e != nil {
			return "", e
		}
		cellKey := v.Cell()
		old, e := s.mapGet(rev.Selection, cellKey)
		if e != nil {
			return "", e
		}
		c := cell{}
		if old != "" {
			if e = s.load(old, &c); e != nil {
				return "", e
			}
		}
		// Reused result identity is not a new measurement or history observation.
		if parent != "" {
			prior, e := s.Revision(parent)
			if e != nil {
				return "", e
			}
			found, e := s.mapGet(prior.Catalog, k)
			if e != nil {
				return "", e
			}
			if found != "" {
				continue
			}
		}
		c.History, e = s.put(history{r.ID, c.History})
		if e != nil {
			return "", e
		}
		choices := []string{r.ID}
		if c.Current != "" {
			choices = append(choices, c.Current)
		}
		if c.Previous != "" {
			choices = append(choices, c.Previous)
		}
		dates := map[string]time.Time{}
		for _, rid := range choices {
			record, e := s.record(rev.Catalog, "result", rid)
			if e != nil {
				return "", e
			}
			var result wire.Result
			if e = json.Unmarshal(record.Data, &result); e != nil {
				return "", e
			}
			dates[rid] = result.Created
		}
		sort.Slice(choices, func(i, j int) bool {
			if dates[choices[i]].Equal(dates[choices[j]]) {
				return choices[i] > choices[j]
			}
			return dates[choices[i]].After(dates[choices[j]])
		})
		c.Current = choices[0]
		if len(choices) > 1 {
			c.Previous = choices[1]
		}
		digest, e := s.put(c)
		if e != nil {
			return "", e
		}
		rev.Selection, e = s.mapSet(rev.Selection, cellKey, digest, 0)
		if e != nil {
			return "", e
		}
	}
	// Portable job + revision roots are durable before the Pebble pointer.
	jb, _ := wire.Encode(j)
	if e = s.installBytes(id, jb); e != nil {
		return "", e
	}
	revID, e := s.put(rev)
	if e != nil {
		return "", e
	}
	if e = s.checkpoint("indexes"); e != nil {
		return "", e
	}
	rb, _ := wire.Encode(rev)
	batch := s.db.NewBatch()
	defer batch.Close()
	if e = s.releaseImport(batch, id, j); e != nil {
		return "", e
	}
	for _, pair := range []struct{ k, v []byte }{{key("revision", revID), rb}, {key("accepted", id), []byte(revID)}, {key("current"), []byte(revID)}} {
		if e = batch.Set(pair.k, pair.v, nil); e != nil {
			return "", e
		}
	}
	if e = s.checkpoint("before-commit"); e != nil {
		return "", e
	}
	if e = ctx.Err(); e != nil {
		return "", e
	}
	if e = batch.Commit(pebble.Sync); e != nil {
		s.poisoned.Store(true)
		return "", e
	}
	// Deliberately separate Pebble visibility from public visibility until sync.
	if e = s.checkpoint("after-commit"); e != nil {
		s.poisoned.Store(true)
		return "", e
	}
	if e = s.portable(revID); e != nil {
		s.poisoned.Store(true)
		return "", e
	}
	if e = s.checkpoint("after-portable"); e != nil {
		s.poisoned.Store(true)
		return "", e
	}
	s.mu.Lock()
	s.published[revID] = rev
	s.current = revID
	s.mu.Unlock()
	return revID, nil
}
func (s *Store) record(root, kind, id string) (wire.Record, error) {
	var r wire.Record
	h, e := s.mapGet(root, kind+":"+id)
	if e != nil {
		return r, e
	}
	if h == "" {
		return r, ErrNotFound
	}
	e = s.load(h, &r)
	return r, e
}
func (s *Store) Record(revision, kind, id string) (wire.Record, error) {
	rev, e := s.Revision(revision)
	if e != nil {
		return wire.Record{}, e
	}
	return s.record(rev.Catalog, kind, id)
}
