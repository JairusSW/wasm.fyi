package store

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"github.com/cockroachdb/pebble/v2"
)

// The durable filesystem pointer is written after the synchronous DB commit
// and before acknowledgement. It makes a content-only rebuild unambiguous:
// unpublished CAS roots cannot become public by being found in a directory.
type portablePointer struct {
	Schema  int    `json:"schema"`
	Current string `json:"current"`
}

func atomicFile(path string, b []byte, mode os.FileMode) error {
	f, e := os.CreateTemp(filepath.Dir(path), ".atomic-")
	if e != nil {
		return e
	}
	defer os.Remove(f.Name())
	if e = f.Chmod(mode); e != nil {
		f.Close()
		return e
	}
	if _, e = f.Write(b); e != nil {
		f.Close()
		return e
	}
	if e = f.Sync(); e != nil {
		f.Close()
		return e
	}
	if e = f.Close(); e != nil {
		return e
	}
	if e = os.Rename(f.Name(), path); e != nil {
		return e
	}
	return syncDir(filepath.Dir(path))
}
func (s *Store) portable(current string) error {
	b, e := wire.Encode(portablePointer{1, current})
	if e != nil {
		return e
	}
	return atomicFile(filepath.Join(s.root, "published.json"), b, 0600)
}

// Reachability is typed: posting-set cell IDs are logical keys, not blob hashes.
// Visit each shared object only once, irrespective of the number of revisions.
func (s *Store) reachable(includeStaging bool) (map[string]bool, error) {
	marked := map[string]bool{}
	visited := map[string]bool{}
	read := func(id string, v any) error {
		b, e := s.content(id)
		if e != nil {
			return e
		}
		marked[id] = true
		return wire.Decode(b, v)
	}
	var markMap func(string, string, func(string, string) error) error
	markMap = func(id, kind string, entry func(string, string) error) error {
		if id == "" {
			return nil
		}
		tag := kind + ":" + id
		if visited[tag] {
			return nil
		}
		visited[tag] = true
		var n node
		if e := read(id, &n); e != nil {
			return e
		}
		if e := validateNode(n); e != nil {
			return e
		}
		if n.Children != nil {
			for _, child := range n.Children {
				if e := markMap(child, kind, entry); e != nil {
					return e
				}
			}
		} else {
			for k, v := range n.Entries {
				if e := entry(k, v); e != nil {
					return e
				}
			}
		}
		return nil
	}
	var markEvidence func(string) error
	markEvidence = func(id string) error {
		if marked[id] {
			return nil
		}
		b, e := s.content(id)
		if e != nil {
			return e
		}
		marked[id] = true
		refs, e := wire.EvidenceReferences(b)
		if e != nil {
			return e
		}
		resource, e := wire.Resource(b)
		if e != nil {
			return e
		}
		if resource != nil {
			if e = wire.VerifyResource(*resource, s.content); e != nil {
				return e
			}
		}
		for _, ref := range refs {
			if e = markEvidence(ref); e != nil {
				return e
			}
		}
		return nil
	}
	markRecord := func(_ string, id string) error {
		if visited["record:"+id] {
			return nil
		}
		visited["record:"+id] = true
		var r wire.Record
		if e := read(id, &r); e != nil {
			return e
		}
		if r.Kind == "artifact" {
			artifact, e := wire.ArtifactData(r.Data)
			if e != nil {
				return e
			}
			if e = s.validateNativeInspection(artifact, "", s.content); e != nil {
				return e
			}
			if artifact.Content.Status == "available" {
				object := wire.Object{SHA256: artifact.Content.SHA256, Bytes: artifact.Content.Bytes, Kind: "binary"}
				if _, e = s.objectRepresentation(object); e != nil {
					return e
				}
				marked[object.SHA256] = true
			}
			if artifact.Inspection.Metadata != "" {
				if e := markEvidence(artifact.Inspection.Metadata); e != nil {
					return e
				}
			}
		}
		if r.Kind == "report" {
			var report struct {
				PassContexts []string `json:"passContexts"`
			}
			if e := json.Unmarshal(r.Data, &report); e != nil {
				return e
			}
			for _, ref := range report.PassContexts {
				if e := markEvidence(ref); e != nil {
					return e
				}
			}
		}
		if r.Kind == "result" {
			var v wire.Result
			if e := wire.Decode(r.Data, &v); e != nil {
				return e
			}
			if e := v.ValidateMethod(); e != nil {
				return e
			}
			for _, ref := range v.Evidence {
				if e := markEvidence(ref); e != nil {
					return e
				}
			}
		}
		return nil
	}
	var markHistory func(string) error
	markHistory = func(id string) error {
		for id != "" {
			if visited["history:"+id] {
				return nil
			}
			visited["history:"+id] = true
			var h history
			if e := read(id, &h); e != nil {
				return e
			}
			id = h.Previous
		}
		return nil
	}
	markSelection := func(_ string, id string) error {
		var c cell
		if e := read(id, &c); e != nil {
			return e
		}
		return markHistory(c.History)
	}
	markIndexes := func(k, id string) error {
		var tuple []string
		if e := json.Unmarshal([]byte(k), &tuple); e != nil || len(tuple) != 3 {
			return fmt.Errorf("invalid index directory key")
		}
		var set indexSet
		if e := read(id, &set); e != nil {
			return e
		}
		switch tuple[0] {
		case "catalog":
			return markMap(set.Root, "posting-record", markRecord)
		case "cells":
			return markMap(set.Root, "posting-cell", func(_, _ string) error { return nil })
		default:
			return fmt.Errorf("unsupported index type")
		}
	}
	jobs := map[string]bool{}
	for _, id := range s.Revisions() {
		var r Revision
		if e := read(id, &r); e != nil {
			return nil, e
		}
		if e := markMap(r.Catalog, "catalog", markRecord); e != nil {
			return nil, e
		}
		if e := markMap(r.Selection, "selection", markSelection); e != nil {
			return nil, e
		}
		if e := markMap(r.Indexes, "indexes", markIndexes); e != nil {
			return nil, e
		}
		if r.Observations != "" {
			if r.ObservationPolicy != "source-summary-v1" {
				return nil, fmt.Errorf("unsupported observation policy")
			}
			if e := markMap(r.Observations, "observations", func(id, result string) error {
				record, e := s.record(r.Catalog, "result", result)
				if e != nil {
					return e
				}
				actual, e := observationID(record)
				if e != nil {
					return e
				}
				if actual != id {
					return fmt.Errorf("observation identity differs")
				}
				return nil
			}); e != nil {
				return nil, e
			}
		}
		var job wire.Job
		if e := read(r.Job, &job); e != nil {
			return nil, e
		}
		if e := job.Validate(); e != nil {
			return nil, e
		}
		jobs[r.Job] = true
		for _, export := range job.Exports {
			payload, e := s.manifestObjects(export.Manifest, false)
			if e != nil {
				return nil, e
			}
			for _, page := range export.Manifest.InventoryPages {
				payload = append(payload, page.Object())
			}
			for _, object := range payload {
				b, e := s.objectRepresentation(object)
				if e != nil {
					return nil, e
				}
				if len(b) != object.Bytes {
					return nil, fmt.Errorf("content size differs")
				}
				marked[object.SHA256] = true
			}
		}
	}
	if includeStaging {
		prefix := key("import")
		it, e := s.db.NewIter(nil)
		if e != nil {
			return nil, e
		}
		defer it.Close()
		for it.SeekGE(prefix); it.Valid() && bytes.HasPrefix(it.Key(), prefix); it.Next() {
			var job wire.Job
			if e = wire.Decode(it.Value(), &job); e != nil {
				return nil, e
			}
			id := wire.Hash(it.Value())
			if jobs[id] {
				continue
			}
			if _, e = s.get(key("aborted", id)); e == nil {
				continue
			} else if !errors.Is(e, pebble.ErrNotFound) {
				return nil, e
			}
			for _, export := range job.Exports {
				payload, e := s.manifestObjects(export.Manifest, true)
				if e != nil {
					return nil, e
				}
				for _, page := range export.Manifest.InventoryPages {
					payload = append(payload, page.Object())
				}
				for _, object := range payload {
					marked[object.SHA256] = true
					b, e := s.objectRepresentation(object)
					if os.IsNotExist(e) {
						continue
					}
					if e != nil {
						return nil, e
					}
					if len(b) != object.Bytes {
						return nil, fmt.Errorf("staged content size differs")
					}
					marked[object.SHA256] = true
				}
			}
		}
		if e = it.Error(); e != nil {
			return nil, e
		}
	}
	return marked, nil
}
func validateNode(n node) error {
	if (n.Children != nil) == (n.Entries != nil) {
		return fmt.Errorf("invalid radix node shape")
	}
	if len(n.Entries) > 32 || len(n.Children) > 16 {
		return fmt.Errorf("radix node exceeds fanout")
	}
	if len(n.Entries) == 0 && len(n.Children) == 0 {
		return fmt.Errorf("empty radix node")
	}
	for prefix, id := range n.Children {
		if len(prefix) != 1 || !bytes.ContainsRune([]byte("0123456789abcdef"), rune(prefix[0])) || !wire.IsHash(id) {
			return fmt.Errorf("invalid radix branch")
		}
	}
	return nil
}

// Rebuild a brand-new database using only the acknowledged portable pointer and
// immutable content. Source directories are never modified or silently reused.
func Rebuild(source, destination, publisher string) error {
	if _, e := os.Lstat(destination); e == nil {
		return fmt.Errorf("destination already exists")
	} else if !os.IsNotExist(e) {
		return e
	}
	fs, e := os.OpenRoot(source)
	if e != nil {
		return e
	}
	defer fs.Close()
	b, e := readRegular(fs, "published.json", 4096)
	if e != nil {
		return e
	}
	var pointer portablePointer
	if e = wire.Decode(b, &pointer); e != nil {
		return e
	}
	if pointer.Schema != 1 || pointer.Current != "" && !wire.IsHash(pointer.Current) {
		return fmt.Errorf("invalid publication pointer")
	}
	objects, e := os.OpenRoot(filepath.Join(source, "objects"))
	if e != nil {
		return e
	}
	defer objects.Close()
	reader := &Store{root: source, objects: objects, published: map[string]Revision{}}
	chain := []string{}
	for id := pointer.Current; id != ""; {
		if len(chain) >= 1000000 {
			return ErrLimit
		}
		var r Revision
		if e = reader.load(id, &r); e != nil {
			return e
		}
		if r.Parent != "" && !wire.IsHash(r.Parent) {
			return fmt.Errorf("invalid parent revision")
		}
		reader.published[id] = r
		chain = append(chain, id)
		id = r.Parent
	}
	reader.current = pointer.Current
	marked, e := reader.reachable(false)
	if e != nil {
		return e
	}
	parent := filepath.Dir(destination)
	temp, e := os.MkdirTemp(parent, ".rebuild-")
	if e != nil {
		return e
	}
	defer os.RemoveAll(temp)
	target, e := Open(temp, publisher)
	if e != nil {
		return e
	}
	closed := false
	defer func() {
		if !closed {
			target.Close()
		}
	}()
	ids := make([]string, 0, len(marked))
	for id := range marked {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		b, e := reader.representation(id, wire.BlobBytes)
		if e != nil {
			return e
		}
		if e = target.installRepresentation(id, b, wire.BlobBytes); e != nil {
			return e
		}
	}
	// Reconstruct bindings and receipts from immutable canonical job records.
	for i := len(chain) - 1; i >= 0; i-- {
		id := chain[i]
		rev := reader.published[id]
		var job wire.Job
		if e = reader.load(rev.Job, &job); e != nil {
			return e
		}
		jobID, e := target.Submit(job)
		if e != nil {
			return e
		}
		if jobID != rev.Job {
			return fmt.Errorf("job hash differs during rebuild")
		}
		rb, e := wire.Encode(rev)
		if e != nil {
			return e
		}
		batch := target.db.NewBatch()
		if e = target.releaseImport(batch, jobID, job); e != nil {
			batch.Close()
			return e
		}
		for _, entry := range []struct{ k, v []byte }{{key("revision", id), rb}, {key("accepted", rev.Job), []byte(id)}, {key("current"), []byte(id)}} {
			if e = batch.Set(entry.k, entry.v, nil); e != nil {
				batch.Close()
				return e
			}
		}
		e = batch.Commit(pebble.Sync)
		batch.Close()
		if e != nil {
			return e
		}
	}
	if e = target.portable(pointer.Current); e != nil {
		return e
	}
	if e = target.Close(); e != nil {
		return e
	}
	closed = true
	// Preserve the cursor key only when it is a regular private file.
	if info, e := fs.Lstat("cursor.key"); e == nil {
		if !info.Mode().IsRegular() || info.Size() != 32 {
			return fmt.Errorf("invalid cursor key")
		}
		b, e := readRegular(fs, "cursor.key", 32)
		if e != nil {
			return e
		}
		if e = atomicFile(filepath.Join(temp, "cursor.key"), b, 0600); e != nil {
			return e
		}
	} else if !os.IsNotExist(e) {
		return e
	}
	if e = installDirectory(temp, destination); e != nil {
		return e
	}
	return syncDir(parent)
}

func verifyPortable(source string) error {
	fs, e := os.OpenRoot(source)
	if e != nil {
		return e
	}
	defer fs.Close()
	b, e := readRegular(fs, "published.json", 4096)
	if e != nil {
		return e
	}
	var pointer portablePointer
	if e = wire.Decode(b, &pointer); e != nil {
		return e
	}
	if pointer.Schema != 1 || pointer.Current != "" && !wire.IsHash(pointer.Current) {
		return fmt.Errorf("invalid portable pointer")
	}
	objects, e := os.OpenRoot(filepath.Join(source, "objects"))
	if e != nil {
		return e
	}
	defer objects.Close()
	reader := &Store{root: source, objects: objects, published: map[string]Revision{}, current: pointer.Current}
	for id := pointer.Current; id != ""; {
		if _, seen := reader.published[id]; seen {
			return fmt.Errorf("portable revision cycle")
		}
		if len(reader.published) >= 1000000 {
			return ErrLimit
		}
		var r Revision
		if e = reader.load(id, &r); e != nil {
			return e
		}
		if !wire.IsHash(r.Job) || !wire.IsHash(r.Catalog) || !wire.IsHash(r.Selection) || r.Parent != "" && !wire.IsHash(r.Parent) || r.Observations != "" && !wire.IsHash(r.Observations) {
			return fmt.Errorf("invalid portable revision")
		}
		reader.published[id] = r
		id = r.Parent
	}
	_, e = reader.reachable(false)
	return e
}
