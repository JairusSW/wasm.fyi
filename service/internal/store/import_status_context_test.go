package store

import (
	"context"
	"errors"
	"reflect"
	"testing"
)

type importStatusCancelContext struct {
	context.Context
	cancel context.CancelFunc
	checks int
	stop   int
}

func (c *importStatusCancelContext) Err() error {
	c.checks++
	if c.checks == c.stop {
		c.cancel()
	}
	return c.Context.Err()
}

func TestImportStatusCancellationPreservesStaging(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	job, _ := pagedFixture(t, "cancel-import-status")
	id, err := s.Submit(job)
	if err != nil {
		t.Fatal(err)
	}
	before, err := s.ImportStatus(id)
	if err != nil || before.PendingInventories == 0 || before.MissingComplete {
		t.Fatal("fixture did not require inventories", before, err)
	}
	for _, stop := range []int{1, 4, 7, 10} {
		ctx, cancel := context.WithCancel(context.Background())
		probe := &importStatusCancelContext{Context: ctx, cancel: cancel, stop: stop}
		_, err := s.ImportStatusContext(probe, id)
		cancel()
		if !errors.Is(err, context.Canceled) || probe.checks != stop {
			t.Fatal("import status ignored cancellation", stop, probe.checks, err)
		}
	}
	after, err := s.ImportStatusContext(context.Background(), id)
	if err != nil || !reflect.DeepEqual(before, after) || s.Current() != "" {
		t.Fatal("canceled status changed staging/publication", after, err)
	}
}
