package sqldb

import (
	"context"
	"testing"
)

func TestHistoryInclusiveUTCDays(t *testing.T) {
	ctx := context.Background()
	s, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	c := fixture()
	for _, date := range []string{"2026-10-03T23:59:59.999999999Z", "2026-10-04T00:00:00Z", "2026-10-04T10:00:00Z", "2026-10-04T23:59:59.999999999Z", "2026-10-05T00:00:00Z"} {
		source := *c.Source
		source.AsOf = date
		c.Source = &source
		if _, e = s.Put(ctx, c); e != nil {
			t.Fatal(e)
		}
	}
	q := MatrixQuery{Platform: hash(c.Platform), Phase: "steady", Limit: 10}
	page, e := s.History(ctx, q, "2026-10-04", "2026-10-04")
	if e != nil || page.Total != 3 {
		t.Fatal(page, e)
	}
	equivalent, e := s.History(ctx, q, "2026-10-04T10:00:00Z", "2026-10-04T20:00:00Z")
	if e != nil || equivalent.Total != 3 || equivalent.Revision != page.Revision {
		t.Fatal(equivalent, e)
	}
	for _, bounds := range [][2]string{{"2026-10-05", "2026-10-04"}, {"2026-02-30", ""}, {"", "not-a-date"}} {
		if _, e = s.History(ctx, q, bounds[0], bounds[1]); e == nil {
			t.Fatal("accepted invalid bounds", bounds)
		}
	}
}
