package benchdb

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/cockroachdb/pebble/v2"
)

type Migration struct {
	Records int    `json:"records"`
	Digest  string `json:"digest"`
	Output  string `json:"output"`
}

// MigrateCopy never rewrites the source. A verified checkpoint is compacted in
// the destination; callers switch their data pointer only after success.
func (s *Store) MigrateCopy(ctx context.Context, destination string) (Migration, error) {
	s.write.Lock()
	defer s.write.Unlock()
	out := Migration{Output: destination}
	expected, records, err := s.logicalDigest(ctx)
	if err != nil {
		return out, err
	}
	if err = os.Mkdir(destination, 0700); err != nil {
		return out, err
	}
	if err = s.db.Checkpoint(filepath.Join(destination, "benchmarks")); err != nil {
		return out, err
	}
	copy, err := Open(destination)
	if err != nil {
		return out, err
	}
	defer copy.Close()
	snapshot := copy.db.NewSnapshot()
	iter, err := snapshot.NewIter(nil)
	if err != nil {
		snapshot.Close()
		return out, err
	}
	batch := copy.db.NewIndexedBatch()
	defer func() { batch.Close() }()
	pending := 0
	for iter.First(); iter.Valid(); iter.Next() {
		if err = ctx.Err(); err != nil {
			break
		}
		key := string(iter.Key())
		if !strings.HasPrefix(key, "rows/") && !strings.HasPrefix(key, "history/") {
			continue
		}
		var value measurement
		if err = unmarshalMeasurement(snapshot, iter.Value(), &value); err != nil {
			break
		}
		if err = writeMeasurement(batch, key, value); err != nil {
			break
		}
		platform := strings.SplitN(key, "/", 4)[1]
		if err = prepareCaptureTime(batch, platform, value.CapturedAt); err != nil {
			break
		}
		pending++
		if pending >= 2000 {
			if err = batch.Commit(pebble.Sync); err != nil {
				break
			}
			batch.Close()
			batch = copy.db.NewIndexedBatch()
			pending = 0
		}
	}
	if err == nil {
		err = iter.Error()
	}
	iter.Close()
	snapshot.Close()
	if err != nil {
		return out, err
	}
	if err = batch.Set([]byte("meta/schema"), []byte("2"), nil); err != nil {
		return out, err
	}
	if err = batch.Commit(pebble.Sync); err != nil {
		return out, err
	}
	actual, actualRecords, err := copy.logicalDigest(ctx)
	if err != nil {
		return out, err
	}
	if actual != expected || actualRecords != records {
		return out, fmt.Errorf("migration changed logical records")
	}
	if err = copy.pruneObjects(ctx); err != nil {
		return out, err
	}
	if err = copy.db.Flush(); err != nil {
		return out, err
	}
	if err = copy.db.Compact(ctx, []byte{0}, []byte{255}, true); err != nil {
		return out, err
	}
	out.Records, out.Digest = records, actual
	return out, nil
}

// Metadata, indexes, statuses and ordered samples all contribute to the digest.
// Physical object layout and the schema marker are deliberately excluded.
func (s *Store) logicalDigest(ctx context.Context) (string, int, error) {
	snapshot := s.db.NewSnapshot()
	defer snapshot.Close()
	iter, err := snapshot.NewIter(nil)
	if err != nil {
		return "", 0, err
	}
	defer iter.Close()
	hash := sha256.New()
	records := 0
	for iter.First(); iter.Valid(); iter.Next() {
		if err = ctx.Err(); err != nil {
			return "", 0, err
		}
		key := string(iter.Key())
		if key == "meta/schema" || strings.HasPrefix(key, "objects/") || strings.HasPrefix(key, "prepared/") {
			continue
		}
		value := iter.Value()
		if strings.HasPrefix(key, "rows/") || strings.HasPrefix(key, "history/") {
			var row measurement
			if err = unmarshalMeasurement(snapshot, value, &row); err != nil {
				return "", 0, err
			}
			value = encode(row)
			records++
		}
		fmt.Fprintf(hash, "%d:", len(key))
		hash.Write([]byte(key))
		fmt.Fprintf(hash, "%d:", len(value))
		hash.Write(value)
	}
	if err = iter.Error(); err != nil {
		return "", 0, err
	}
	return hex.EncodeToString(hash.Sum(nil)), records, nil
}

// Offline compaction collects unreferenced shared objects after verified migration.
func (s *Store) pruneObjects(ctx context.Context) error {
	reachable := map[string]bool{}
	iter, err := s.db.NewIter(nil)
	if err != nil {
		return err
	}
	defer iter.Close()
	for iter.First(); iter.Valid(); iter.Next() {
		if err = ctx.Err(); err != nil {
			return err
		}
		key := string(iter.Key())
		data := iter.Value()
		if !strings.HasPrefix(key, "rows/") && !strings.HasPrefix(key, "history/") {
			continue
		}
		if len(data) < 2 || data[0] != 2 {
			return fmt.Errorf("unmigrated measurement")
		}
		flags := data[1]
		data = data[2:]
		for index := 0; index < 4; index++ {
			if flags&(1<<index) == 0 {
				continue
			}
			if len(data) < 32 {
				return fmt.Errorf("truncated object reference")
			}
			reachable[fmt.Sprintf("objects/%d/%s", index, hex.EncodeToString(data[:32]))] = true
			data = data[32:]
		}
	}
	if err = iter.Error(); err != nil {
		return err
	}
	batch := s.db.NewBatch()
	defer batch.Close()
	for valid := iter.SeekGE([]byte("objects/")); valid && strings.HasPrefix(string(iter.Key()), "objects/"); valid = iter.Next() {
		if err = ctx.Err(); err != nil {
			return err
		}
		if !reachable[string(iter.Key())] {
			if err = batch.Delete(append([]byte(nil), iter.Key()...), nil); err != nil {
				return err
			}
		}
	}
	if err = iter.Error(); err != nil {
		return err
	}
	return batch.Commit(pebble.Sync)
}
