package benchdb

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/cockroachdb/pebble/v2"
)

func TestMigrationCopyPreservesLegacyAndPackedRecords(t *testing.T) {
	ctx := context.Background()
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	c := fixture("2026-10-08T00:00:00Z", 1)
	if _, err = s.Put(ctx, c); err != nil {
		t.Fatal(err)
	}
	key := "rows/" + identifier(c.Platform) + "/steady/" + c.Results[0].Workload + "\x00" + c.Results[0].Engine
	data, err := get(s.db, key)
	if err != nil {
		t.Fatal(err)
	}
	var legacy measurement
	if err = unmarshalMeasurement(s.db, data, &legacy); err != nil {
		t.Fatal(err)
	}
	if err = s.db.Set([]byte(key), encode(legacy), pebble.Sync); err != nil {
		t.Fatal(err)
	}
	before, records, err := s.logicalDigest(ctx)
	if err != nil {
		t.Fatal(err)
	}
	destination := filepath.Join(t.TempDir(), "compact")
	receipt, err := s.MigrateCopy(ctx, destination)
	if err != nil {
		t.Fatal(err)
	}
	if receipt.Digest != before || receipt.Records != records {
		t.Fatal("migration receipt differs")
	}
	after, _, err := s.logicalDigest(ctx)
	if err != nil || after != before {
		t.Fatal("source changed", err)
	}
	copy, err := Open(destination)
	if err != nil {
		t.Fatal(err)
	}
	defer copy.Close()
	decoded, _, err := copy.logicalDigest(ctx)
	if err != nil || decoded != before {
		t.Fatal("copy differs", err)
	}
	packed, err := get(copy.db, key)
	if err != nil || packed[0] != 2 {
		t.Fatal("legacy record was not migrated", err)
	}
	if _, err = s.MigrateCopy(ctx, destination); err == nil {
		t.Fatal("overwrote existing migration output")
	}
}
