package store

import (
	"bytes"
	"errors"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"github.com/cockroachdb/pebble/v2"
)

// The caller has verified the published portable closure and copied its content.
// Rebuild restores acknowledged receipts, not pending-import reservations. This
// private method is never called by publisher HTTP or normal Submit admission.
func (s *Store) restorePublishedJob(batch *pebble.Batch, id string, job wire.Job) error {
	if err := job.Validate(); err != nil {
		return err
	}
	body, err := wire.Encode(job)
	if err != nil {
		return err
	}
	if len(body) > wire.JobBytes || wire.Hash(body) != id {
		return wire.Invalid("published job identity differs during rebuild")
	}
	bindings := []struct{ key, value []byte }{
		{key("session", job.Session), mustEncode([]string{job.Plan, job.ConfiguredHarnessPin})},
		{key("member", job.Session, job.Machine), []byte(job.ParentBundleSHA256)},
		{key("attempt", job.Session, job.Machine, job.Corpus, job.Attempt), []byte(id)},
		{key("import", id), body},
	}
	for _, binding := range bindings {
		prior, err := s.get(binding.key)
		if err == nil && !bytes.Equal(prior, binding.value) {
			return ErrConflict
		}
		if err != nil && !errors.Is(err, pebble.ErrNotFound) {
			return err
		}
		if err = batch.Set(binding.key, binding.value, nil); err != nil {
			return err
		}
	}
	return nil
}
