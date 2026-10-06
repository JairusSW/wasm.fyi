package store

import "context"

const observationBatchRecords = 256

// The overlays preserve sequential within-job lookup/ranking semantics while
// materializing each final changed map branch once. They never become public.
type observationBatch struct{ observations, sources map[string]string }

func observationOverlay(pending []*observationBatch, source bool) map[string]string {
	if len(pending) == 0 {
		return nil
	}
	if source {
		return pending[0].sources
	}
	return pending[0].observations
}
func (s *Store) observationLookup(root, key string, updates map[string]string) (string, error) {
	if value, ok := updates[key]; ok {
		return value, nil
	}
	return s.mapGet(root, key)
}
func (s *Store) observationSet(root *string, key, value string, updates map[string]string) error {
	if updates != nil {
		updates[key] = value
		return nil
	}
	var err error
	*root, err = s.mapSet(*root, key, value, 0)
	return err
}
func (b *observationBatch) flush(ctx context.Context, s *Store, rev *Revision) error {
	observations, err := s.mapSetMany(ctx, rev.Observations, b.observations, 0)
	if err != nil {
		return err
	}
	sources, err := s.mapSetMany(ctx, rev.SourceBindings, b.sources, 0)
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	rev.Observations, rev.SourceBindings = observations, sources
	return nil
}
