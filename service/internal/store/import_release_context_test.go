package store

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"github.com/cockroachdb/pebble/v2"
)

func TestImportPermitReleaseCancellationPreservesSharedAccounting(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	first, objects, err := testutil.Fixture("release-first", time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	second, _, err := testutil.Fixture("release-second", time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	id, err := s.Submit(first)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Submit(second); err != nil {
		t.Fatal(err)
	}
	shared := ""
	var original objectPermit
	for hash := range objects {
		data, err := s.get(key("permit", hash))
		if err != nil {
			t.Fatal(err)
		}
		if err = wire.Decode(data, &original); err != nil {
			t.Fatal(err)
		}
		if original.References == 2 {
			shared = hash
			break
		}
	}
	if shared == "" {
		t.Fatal("fixture lacks shared permits")
	}
	quota, err := s.quota()
	if err != nil {
		t.Fatal(err)
	}
	before, err := s.ImportStatus(id)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	probe := &importStatusCancelContext{Context: ctx, cancel: cancel, stop: 3}
	batch := s.db.NewBatch()
	err = s.releaseImportContext(probe, batch, id)
	batch.Close()
	cancel()
	if !errors.Is(err, context.Canceled) || probe.checks != 3 {
		t.Fatal("permit traversal ignored cancellation", err, probe.checks)
	}
	ctx, cancel = context.WithCancel(context.Background())
	probe = &importStatusCancelContext{Context: ctx, cancel: cancel, stop: 5}
	err = s.AbortContext(probe, id)
	cancel()
	if !errors.Is(err, context.Canceled) {
		t.Fatal("abort ignored cancellation", err)
	}
	after, err := s.ImportStatus(id)
	if err != nil || !reflect.DeepEqual(before, after) || s.Current() != "" {
		t.Fatal("cancellation changed import state", after, err)
	}
	gotQuota, err := s.quota()
	if err != nil || gotQuota != quota {
		t.Fatal("cancellation changed quota", gotQuota, err)
	}
	data, err := s.get(key("permit", shared))
	var permit objectPermit
	if err != nil || wire.Decode(data, &permit) != nil || permit != original {
		t.Fatal("cancellation changed shared permit", permit, err)
	}
	if _, err = s.get(key("aborted", id)); !errors.Is(err, pebble.ErrNotFound) {
		t.Fatal("canceled abort left a marker", err)
	}
	if err = s.AbortContext(context.Background(), id); err != nil {
		t.Fatal("abort retry failed", err)
	}
	data, err = s.get(key("permit", shared))
	if err != nil || wire.Decode(data, &permit) != nil || permit.References != 1 {
		t.Fatal("retry lost another import's permit", permit, err)
	}
}
