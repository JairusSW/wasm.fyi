package store

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"github.com/cockroachdb/pebble/v2"
)

var ErrQuota = errors.New("configured storage or pending-import quota exceeded")
var ErrUndeclared = errors.New("object is not declared by an active import")

type Limits struct {
	PendingJobs  int
	PendingBytes int64
	ContentBytes int64
}

func DefaultLimits() Limits {
	return Limits{PendingJobs: 128, PendingBytes: 512 << 20, ContentBytes: 50 << 30}
}

type pendingImport struct {
	Bytes     int64     `json:"bytes"`
	Submitted time.Time `json:"submittedAt"`
}
type admissionQuota struct {
	Schema int   `json:"schema"`
	Jobs   int   `json:"jobs"`
	Bytes  int64 `json:"bytes"`
}
type objectPermit struct {
	Object     wire.Object `json:"object"`
	References int         `json:"references"`
}

func declaredObjects(j wire.Job) map[string]wire.Object {
	out := map[string]wire.Object{}
	if j.SessionPlan != nil {
		for _, o := range j.SessionPlan.Chunks {
			out[o.SHA256] = o
		}
	}
	if j.ParentArchive != nil {
		for _, o := range j.ParentArchive.Objects() {
			out[o.SHA256] = o
		}
	}
	for _, x := range j.Exports {
		for _, o := range x.Manifest.Objects {
			out[o.SHA256] = o
		}
		for _, page := range x.Manifest.InventoryPages {
			out[page.SHA256] = page.Object()
		}
	}
	return out
}
func (s *Store) quota() (admissionQuota, error) {
	q := admissionQuota{Schema: 1}
	b, e := s.get(key("quota"))
	if errors.Is(e, pebble.ErrNotFound) {
		return q, nil
	}
	if e != nil {
		return q, e
	}
	e = wire.Decode(b, &q)
	return q, e
}
func setJSON(batch *pebble.Batch, k []byte, v any) error {
	b, e := wire.Encode(v)
	if e != nil {
		return e
	}
	return batch.Set(k, b, nil)
}
func (s *Store) reserveImport(batch *pebble.Batch, id string, j wire.Job) error {
	q, e := s.quota()
	if e != nil {
		return e
	}
	objects := declaredObjects(j)
	var size int64
	for _, o := range objects {
		size += int64(o.Bytes)
	}
	pages := map[string]bool{}
	for _, export := range j.Exports {
		for _, page := range export.Manifest.InventoryPages {
			if !pages[page.SHA256] {
				size += page.ContentBytes
				pages[page.SHA256] = true
			}
		}
	}
	if q.Jobs >= s.limits.PendingJobs || size > s.limits.PendingBytes-q.Bytes {
		return ErrQuota
	}
	q.Jobs++
	q.Bytes += size
	if e = setJSON(batch, key("quota"), q); e != nil {
		return e
	}
	if e = setJSON(batch, key("pending", id), pendingImport{size, time.Now().UTC()}); e != nil {
		return e
	}
	for _, o := range objects {
		if e = s.grantObject(batch, id, o); e != nil {
			return e
		}
	}

	return nil
}
func (s *Store) releaseImport(batch *pebble.Batch, id string, j wire.Job) error {
	return s.releaseImportContext(context.Background(), batch, id)
}

func (s *Store) releaseImportContext(ctx context.Context, batch *pebble.Batch, id string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	b, e := s.get(key("pending", id))
	if errors.Is(e, pebble.ErrNotFound) {
		return nil
	}
	if e != nil {
		return e
	}
	var pending pendingImport
	if e = wire.Decode(b, &pending); e != nil {
		return e
	}
	q, e := s.quota()
	if e != nil {
		return e
	}
	if q.Jobs < 1 || q.Bytes < pending.Bytes {
		return fmt.Errorf("corrupt pending-import accounting")
	}
	q.Jobs--
	q.Bytes -= pending.Bytes
	if e = setJSON(batch, key("quota"), q); e != nil {
		return e
	}
	if e = batch.Delete(key("pending", id), nil); e != nil {
		return e
	}
	prefix := key("permit-owner", id)
	it, e := s.db.NewIter(&pebble.IterOptions{LowerBound: prefix, UpperBound: append(append([]byte(nil), prefix...), 255)})
	if e != nil {
		return e
	}
	defer it.Close()
	for it.SeekGE(prefix); it.Valid() && bytes.HasPrefix(it.Key(), prefix); it.Next() {
		if err := ctx.Err(); err != nil {
			return err
		}
		var object wire.Object
		if e = wire.Decode(it.Value(), &object); e != nil {
			return e
		}
		digest := object.SHA256
		if e = batch.Delete(append([]byte(nil), it.Key()...), nil); e != nil {
			return e
		}
		b, e := s.get(key("permit", digest))
		if e != nil {
			return e
		}
		var permit objectPermit
		if e = wire.Decode(b, &permit); e != nil {
			return e
		}
		if permit.References < 1 {
			return fmt.Errorf("corrupt object permit")
		}
		permit.References--
		if permit.References == 0 {
			e = batch.Delete(key("permit", digest), nil)
		} else {
			e = setJSON(batch, key("permit", digest), permit)
		}
		if e != nil {
			return e
		}
	}
	if e = it.Error(); e != nil {
		return e
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	expanded := key("expanded", id)
	return batch.DeleteRange(expanded, append(append([]byte(nil), expanded...), 255), nil)
}

// HTTP upload admission is serialized with publication/abort and maintenance.
// Internal generated indexes and trusted local loaders use Install directly.
func (s *Store) InstallDeclared(id string, r io.Reader) error {
	s.publish.Lock()
	defer s.publish.Unlock()
	if s.poisoned.Load() {
		return ErrNeedsRestart
	}
	if !wire.IsHash(id) {
		return wire.Invalid("invalid digest")
	}
	b, e := s.get(key("permit", id))
	if errors.Is(e, pebble.ErrNotFound) {
		return ErrUndeclared
	}
	if e != nil {
		return e
	}
	var permit objectPermit
	if e = wire.Decode(b, &permit); e != nil {
		return e
	}
	if permit.References <= 0 {
		return ErrUndeclared
	}
	data, e := io.ReadAll(io.LimitReader(r, int64(permit.Object.Bytes)+1))
	if e != nil {
		return e
	}
	if len(data) != permit.Object.Bytes || wire.Hash(data) != id {
		return wire.Invalid("object differs from declared digest/size")
	}
	if permit.Object.Kind == "binary" {
		return s.installRepresentation(id, data, wire.BlobBytes)
	}
	return s.installBytes(id, data)
}
func (s *Store) Abort(id string) error {
	return s.AbortContext(context.Background(), id)
}

func (s *Store) AbortContext(ctx context.Context, id string) error {
	if err := s.publish.LockContext(ctx); err != nil {
		return err
	}
	defer s.publish.Unlock()
	if s.poisoned.Load() {
		return ErrNeedsRestart
	}
	_, e := s.Job(id)
	if e != nil {
		return e
	}
	if _, e = s.get(key("accepted", id)); e == nil {
		return ErrConflict
	} else if !errors.Is(e, pebble.ErrNotFound) {
		return e
	}
	batch := s.db.NewBatch()
	defer batch.Close()
	if e = s.releaseImportContext(ctx, batch, id); e != nil {
		return e
	}
	if e = batch.Set(key("aborted", id), []byte("operator-aborted"), nil); e != nil {
		return e
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if e = batch.Commit(pebble.Sync); e != nil {
		s.poisoned.Store(true)
	}
	return e
}

type ImportStatus struct {
	ID                 string `json:"id"`
	Session            string `json:"session"`
	Machine            string `json:"machine"`
	Corpus             string `json:"corpus"`
	Attempt            string `json:"attempt"`
	State              string `json:"state"`
	Revision           string `json:"revision,omitempty"`
	Objects            int    `json:"objects"`
	Missing            int    `json:"missing"`
	Bytes              int64  `json:"declaredBytes"`
	PendingInventories int    `json:"pendingInventories"`
	MissingComplete    bool   `json:"missingComplete"`
}

func (s *Store) ImportStatus(id string) (ImportStatus, error) {
	return s.ImportStatusContext(context.Background(), id)
}

func (s *Store) ImportStatusContext(ctx context.Context, id string) (ImportStatus, error) {
	if err := ctx.Err(); err != nil {
		return ImportStatus{}, err
	}
	j, e := s.Job(id)
	if e != nil {
		return ImportStatus{}, e
	}
	status := ImportStatus{ID: id, Session: j.Session, Machine: j.Machine, Corpus: j.Corpus, Attempt: j.Attempt, State: "staged", MissingComplete: true}
	for _, o := range declaredObjects(j) {
		if err := ctx.Err(); err != nil {
			return status, err
		}
		status.Objects++
		status.Bytes += int64(o.Bytes)
	}
	seenPages := map[string]bool{}
	for _, export := range j.Exports {
		for _, page := range export.Manifest.InventoryPages {
			if err := ctx.Err(); err != nil {
				return status, err
			}
			if !seenPages[page.SHA256] {
				status.Objects += page.Objects
				status.Bytes += page.ContentBytes
				seenPages[page.SHA256] = true
			}
		}
	}
	if err := ctx.Err(); err != nil {
		return status, err
	}
	if b, e := s.get(key("accepted", id)); e == nil {
		revision := string(b)
		if _, e = s.Revision(revision); e != nil {
			return status, ErrNeedsRestart
		}
		status.State = "published"
		status.Revision = revision
		return status, nil
	} else if !errors.Is(e, pebble.ErrNotFound) {
		return status, e
	}
	if _, e = s.get(key("aborted", id)); e == nil {
		status.State = "aborted"
		return status, nil
	} else if !errors.Is(e, pebble.ErrNotFound) {
		return status, e
	}
	clear(seenPages)
	for _, export := range j.Exports {
		for _, page := range export.Manifest.InventoryPages {
			if err := ctx.Err(); err != nil {
				return status, err
			}
			if seenPages[page.SHA256] {
				continue
			}
			seenPages[page.SHA256] = true
			if _, e = s.get(key("expanded", id, page.SHA256)); errors.Is(e, pebble.ErrNotFound) {
				status.PendingInventories++
			} else if e != nil {
				return status, e
			}
		}
	}
	status.MissingComplete = status.PendingInventories == 0
	missing, e := s.MissingContext(ctx, id)
	if e != nil {
		return status, e
	}
	status.Missing = len(missing)
	return status, nil
}
func (s *Store) initializeAdmission() error {
	if _, e := s.get(key("admission-ready-v3")); e == nil {
		return nil
	} else if !errors.Is(e, pebble.ErrNotFound) {
		return e
	}
	// A migration interrupted before its completion marker is rebuilt from the
	// canonical imports, never resumed using partly updated counters.
	reset := s.db.NewBatch()
	for _, namespace := range []string{"pending", "permit", "permit-owner", "expanded"} {
		prefix := key(namespace)
		if e := reset.DeleteRange(prefix, append(append([]byte(nil), prefix...), 255), nil); e != nil {
			reset.Close()
			return e
		}
	}
	if e := reset.Set(key("quota"), mustQuota(), nil); e != nil {
		reset.Close()
		return e
	}
	e := reset.Commit(pebble.Sync)
	reset.Close()
	if e != nil {
		return e
	}
	prefix := key("import")
	it, e := s.db.NewIter(nil)
	if e != nil {
		return e
	}
	defer it.Close()
	for it.SeekGE(prefix); it.Valid() && bytes.HasPrefix(it.Key(), prefix); it.Next() {
		id := wire.Hash(it.Value())
		skip := false
		for _, namespace := range []string{"accepted", "aborted"} {
			if _, e = s.get(key(namespace, id)); e == nil {
				skip = true
				break
			} else if !errors.Is(e, pebble.ErrNotFound) {
				return e
			}
		}
		if skip {
			continue
		}
		var j wire.Job
		if e = wire.Decode(it.Value(), &j); e != nil {
			return e
		}
		batch := s.db.NewIndexedBatch()
		e = s.reserveImport(batch, id, j)
		if e == nil {
			e = batch.Commit(pebble.Sync)
		}
		batch.Close()
		if e != nil {
			return e
		}
	}
	if e = it.Error(); e != nil {
		return e
	}
	if e = s.initializePlanAdmission(); e != nil {
		return e
	}
	return s.db.Set(key("admission-ready-v3"), []byte{1}, pebble.Sync)
}
func mustQuota() []byte { b, _ := wire.Encode(admissionQuota{Schema: 1}); return b }
func (s *Store) scanContentUsage() error {
	for _, name := range []string{"objects", "quarantine"} {
		directory := filepath.Join(s.root, name)
		if name == "quarantine" {
			info, e := os.Lstat(directory)
			if os.IsNotExist(e) {
				continue
			}
			if e != nil {
				return e
			}
			if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
				return fmt.Errorf("invalid quarantine directory")
			}
		}
		dir, e := os.Open(directory)
		if e != nil {
			return e
		}
		for {
			entries, e := dir.ReadDir(1000)
			for _, entry := range entries {
				if name == "quarantine" && !wire.IsHash(entry.Name()) {
					continue
				}
				info, err := entry.Info()
				if err != nil {
					dir.Close()
					return err
				}
				if !info.Mode().IsRegular() {
					dir.Close()
					return fmt.Errorf("unexpected entry in content directory")
				}
				s.contentBytes += info.Size()
			}
			if errors.Is(e, io.EOF) {
				break
			}
			if e != nil {
				dir.Close()
				return e
			}
		}
		if e = dir.Close(); e != nil {
			return e
		}
	}
	return nil
}
