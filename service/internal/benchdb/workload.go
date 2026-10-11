package benchdb

import (
	"context"
	"fmt"
	"strings"

	"github.com/cockroachdb/pebble/v2"
)

// HasWorkload checks bounded key prefixes across platforms and phases without
// decoding samples or scanning pages. Current and historical bindings count;
// retained contract metadata alone is not an available workload page.
func (s *Store) HasWorkload(ctx context.Context, workload string) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	snapshot := s.db.NewSnapshot()
	defer snapshot.Close()
	platforms, err := snapshot.NewIter(&pebble.IterOptions{LowerBound: []byte("platforms/"), UpperBound: prefixEnd("platforms/")})
	if err != nil {
		return false, err
	}
	defer platforms.Close()
	rows, err := snapshot.NewIter(nil)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	for platforms.First(); platforms.Valid(); platforms.Next() {
		if err = ctx.Err(); err != nil {
			return false, err
		}
		platform := strings.TrimPrefix(string(platforms.Key()), "platforms/")
		for _, phase := range []string{"compile", "instantiate", "first-call", "steady"} {
			prefix := "rows/" + platform + "/" + phase + "/" + workload + "\x00"
			if rows.SeekGE([]byte(prefix)) && strings.HasPrefix(string(rows.Key()), prefix) {
				return true, nil
			}
			if err = rows.Error(); err != nil {
				return false, err
			}
			found, err := historicalWorkload(ctx, rows, "history/"+platform+"/"+phase+"/", workload)
			if err != nil || found {
				return found, err
			}
		}
	}
	return false, platforms.Error()
}

// Historical keys are date-first. Seek once within each date and then jump over
// its entire remaining key range, so unrelated measurement rows are never read.
func historicalWorkload(ctx context.Context, rows *pebble.Iterator, phasePrefix, workload string) (bool, error) {
	for valid := rows.SeekGE([]byte(phasePrefix)); valid && strings.HasPrefix(string(rows.Key()), phasePrefix); {
		if err := ctx.Err(); err != nil {
			return false, err
		}
		date, _, ok := strings.Cut(strings.TrimPrefix(string(rows.Key()), phasePrefix), "\x00")
		if !ok {
			return false, fmt.Errorf("invalid historical binding key")
		}
		datePrefix := phasePrefix + date + "\x00"
		prefix := datePrefix + workload + "\x00"
		if rows.SeekGE([]byte(prefix)) && strings.HasPrefix(string(rows.Key()), prefix) {
			return true, nil
		}
		if err := rows.Error(); err != nil {
			return false, err
		}
		valid = rows.SeekGE(prefixEnd(datePrefix))
	}
	return false, rows.Error()
}
