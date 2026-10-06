package store

import (
	"context"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

// Membership and descriptor availability govern byte access, never a bare hash.
func (s *Store) ArtifactBytes(ctx context.Context, revision, id string) (wire.Artifact, []byte, error) {
	record, err := s.Record(revision, "artifact", id)
	if err != nil {
		return wire.Artifact{}, nil, err
	}
	artifact, err := wire.ArtifactData(record.Data)
	if err != nil {
		return artifact, nil, err
	}
	if artifact.Content.Status != "available" {
		return artifact, nil, ErrNotFound
	}
	if err = ctx.Err(); err != nil {
		return artifact, nil, err
	}
	b, err := s.objectRepresentationContext(ctx, wire.Object{SHA256: artifact.Content.SHA256, Bytes: artifact.Content.Bytes, Kind: "binary"})
	if err == nil {
		err = ctx.Err()
	}
	return artifact, b, err
}
func (s *Store) ArtifactEvidence(ctx context.Context, revision, id, digest string) ([]byte, error) {
	record, err := s.Record(revision, "artifact", id)
	if err != nil {
		return nil, err
	}
	artifact, err := wire.ArtifactData(record.Data)
	if err != nil {
		return nil, err
	}
	if artifact.Inspection.Metadata == "" {
		return nil, ErrNotFound
	}
	return s.evidenceContext(ctx, []string{artifact.Inspection.Metadata}, digest)
}
