package store

import (
	"context"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"io"
)

// Only a revision's published job index admits access. Import IDs alone do not.
func (s *Store) PublishedArchive(ctx context.Context, revision, id string) (wire.Job, error) {
	rev, err := s.Revision(revision)
	if err != nil {
		return wire.Job{}, err
	}
	if err = ctx.Err(); err != nil {
		return wire.Job{}, err
	}
	set, err := s.indexGet(rev.Indexes, indexKey("published-job", "", ""))
	if err != nil {
		return wire.Job{}, err
	}
	digest, err := s.mapGet(set.Root, id)
	if err != nil {
		return wire.Job{}, err
	}
	if digest != "" {
		var summary PublishedJob
		if err = s.load(digest, &summary); err != nil {
			return wire.Job{}, err
		}
		if summary.ID != id {
			return wire.Job{}, wire.Invalid("published job binding differs")
		}
		var job wire.Job
		if err = s.load(id, &job); err != nil {
			return job, err
		}
		return job, job.Validate()
	}
	// Compatibility for immutable revisions published before the direct lookup.
	raw, err := s.jobContent(id)
	if err != nil {
		return wire.Job{}, ErrNotFound
	}
	var job wire.Job
	if err = wire.Decode(raw, &job); err != nil {
		return wire.Job{}, ErrNotFound
	}
	legacy, err := s.indexGet(rev.Indexes, indexKey("session-jobs", job.Session, ""))
	if err != nil {
		return wire.Job{}, err
	}
	key := publishedJobKey(jobSummary(job, id, rev.Created))
	digest, err = s.mapGet(legacy.Root, key)
	if err != nil {
		return wire.Job{}, err
	}
	if digest == "" {
		return wire.Job{}, ErrNotFound
	}
	var summary PublishedJob
	if err = s.load(digest, &summary); err != nil {
		return wire.Job{}, err
	}
	if summary.ID != id || summary.Session != job.Session {
		return wire.Job{}, wire.Invalid("published job binding differs")
	}
	return job, job.Validate()
}
func (s *Store) ArchiveObject(ctx context.Context, revision, id, digest string) (wire.Object, []byte, error) {
	job, err := s.PublishedArchive(ctx, revision, id)
	if err != nil {
		return wire.Object{}, nil, err
	}
	if job.ParentArchive == nil {
		return wire.Object{}, nil, ErrNotFound
	}
	for _, o := range job.ParentArchive.Objects() {
		if o.SHA256 == digest {
			if err := ctx.Err(); err != nil {
				return o, nil, err
			}
			b, err := s.objectRepresentation(o)
			if err == nil {
				err = ctx.Err()
			}
			return o, b, err
		}
	}
	return wire.Object{}, nil, ErrNotFound
}
func (s *Store) OpenArchive(ctx context.Context, revision, id string) (wire.ParentArchive, io.Reader, error) {
	job, err := s.PublishedArchive(ctx, revision, id)
	if err != nil {
		return wire.ParentArchive{}, nil, err
	}
	if job.ParentArchive == nil {
		return wire.ParentArchive{}, nil, ErrNotFound
	}
	parent := *job.ParentArchive
	fetch := func(o wire.Object) ([]byte, error) {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		b, err := s.objectRepresentation(o)
		if err == nil {
			err = ctx.Err()
		}
		return b, err
	}
	if err = parent.Verify(job, fetch); err != nil {
		return parent, nil, err
	}
	chunks := make([]wire.FileChunk, 0, len(parent.Chunks))
	for _, o := range parent.Chunks {
		chunks = append(chunks, wire.FileChunk{SHA256: o.SHA256, Bytes: o.Bytes})
	}
	reader := &reportFileReader{ctx: ctx, chunks: chunks, fetch: func(c wire.FileChunk) ([]byte, error) {
		return fetch(wire.Object{SHA256: c.SHA256, Bytes: c.Bytes, Kind: "binary"})
	}}
	return parent, reader, nil
}
