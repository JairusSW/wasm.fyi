package store

import (
	"context"
	"errors"
	"os"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"github.com/cockroachdb/pebble/v2"
)

// An indexed batch sees grants already made for this import or another page.
func (s *Store) grantObject(batch *pebble.Batch, job string, object wire.Object) error {
	b, closer, err := batch.Get(key("permit-owner", job, object.SHA256))
	if err == nil {
		var old wire.Object
		err = wire.Decode(b, &old)
		closer.Close()
		if err != nil {
			return err
		}
		if old != object {
			return ErrConflict
		}
		return nil
	}
	if !errors.Is(err, pebble.ErrNotFound) {
		return err
	}
	permit := objectPermit{Object: object}
	b, closer, err = batch.Get(key("permit", object.SHA256))
	if err == nil {
		err = wire.Decode(b, &permit)
		closer.Close()
		if err != nil {
			return err
		}
		if permit.Object != object {
			return ErrConflict
		}
	} else if !errors.Is(err, pebble.ErrNotFound) {
		return err
	}
	permit.References++
	if err = setJSON(batch, key("permit", object.SHA256), permit); err != nil {
		return err
	}
	return setJSON(batch, key("permit-owner", job, object.SHA256), object)
}
func (s *Store) expandInventory(ctx context.Context, batch *pebble.Batch, job string, page wire.Inventory, b []byte) error {
	objects, err := page.Decode(b)
	if err != nil {
		return err
	}
	for _, object := range objects {
		if err = ctx.Err(); err != nil {
			return err
		}
		if err = s.grantObject(batch, job, object); err != nil {
			return err
		}
	}
	return batch.Set(key("expanded", job, page.SHA256), []byte{1}, nil)
}

// AttachInventory grants only the leaf descriptors committed by this job's root.
// It reserves no additional quota: the complete payload was reserved at Submit.
func (s *Store) AttachInventory(job, digest string) error {
	return s.AttachInventoryContext(context.Background(), job, digest)
}
func (s *Store) AttachInventoryContext(ctx context.Context, job, digest string) error {
	s.publish.Lock()
	defer s.publish.Unlock()
	if s.poisoned.Load() {
		return ErrNeedsRestart
	}
	j, err := s.Job(job)
	if err != nil {
		return err
	}
	if _, err = s.get(key("aborted", job)); err == nil {
		return ErrConflict
	} else if !errors.Is(err, pebble.ErrNotFound) {
		return err
	}
	var descriptor *wire.Inventory
	for _, export := range j.Exports {
		for _, page := range export.Manifest.InventoryPages {
			if page.SHA256 == digest {
				p := page
				descriptor = &p
			}
		}
	}
	if descriptor == nil {
		return ErrUndeclared
	}
	if _, err = s.get(key("accepted", job)); err == nil {
		return nil
	} else if !errors.Is(err, pebble.ErrNotFound) {
		return err
	}
	if _, err = s.get(key("expanded", job, digest)); err == nil {
		return nil
	} else if !errors.Is(err, pebble.ErrNotFound) {
		return err
	}
	b, err := s.content(digest)
	if err != nil {
		return err
	}
	batch := s.db.NewIndexedBatch()
	defer batch.Close()
	if err = s.expandInventory(ctx, batch, job, *descriptor, b); err != nil {
		return err
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	if err = batch.Commit(pebble.Sync); err != nil {
		s.poisoned.Store(true)
	}
	return err
}

// manifestObjects returns verified payload descriptors. Missing pages are retained
// as missing roots by callers; complete publication requires every page.
func (s *Store) manifestObjects(m wire.Manifest, partial bool) ([]wire.Object, error) {
	return s.manifestObjectsContext(context.Background(), m, partial)
}
func (s *Store) manifestObjectsContext(ctx context.Context, m wire.Manifest, partial bool) ([]wire.Object, error) {
	if e := ctx.Err(); e != nil {
		return nil, e
	}
	out := append([]wire.Object{}, m.Objects...)
	seen := map[string]bool{}
	for _, object := range out {
		seen[object.SHA256] = true
	}
	for _, page := range m.InventoryPages {
		if e := ctx.Err(); e != nil {
			return nil, e
		}
		b, err := s.content(page.SHA256)
		if partial && os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		objects, err := page.Decode(b)
		if err != nil {
			return nil, err
		}
		for _, object := range objects {
			if e := ctx.Err(); e != nil {
				return nil, e
			}
			if seen[object.SHA256] {
				return nil, wire.Invalid("repeated inventory payload")
			}
			seen[object.SHA256] = true
			out = append(out, object)
		}
	}
	return out, nil
}
