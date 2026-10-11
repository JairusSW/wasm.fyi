package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/benchdb"
	"github.com/JairusSW/wasm.fyi/service/internal/sqldb"
)

type bindingDigest struct{ hashes [][32]byte }

func (d *bindingDigest) add(scope string, p benchdb.Platform, r benchdb.Result) error {
	data, err := json.Marshal(struct {
		Scope    string
		Platform benchdb.Platform
		Result   benchdb.Result
	}{scope, p, r})
	if err != nil {
		return err
	}
	d.hashes = append(d.hashes, sha256.Sum256(data))
	return nil
}
func (d *bindingDigest) sum() string {
	sort.Slice(d.hashes, func(i, j int) bool { return bytes.Compare(d.hashes[i][:], d.hashes[j][:]) < 0 })
	h := sha256.New()
	for _, v := range d.hashes {
		h.Write(v[:])
	}
	return hex.EncodeToString(h.Sum(nil))
}

// migrateSQL always creates a separate destination and verifies every binding.
func migrateSQL(ctx context.Context, source, destination string) error {
	if destination == "" {
		return fmt.Errorf("migrate-sql requires a new --output directory")
	}
	if err := os.Mkdir(destination, 0700); err != nil {
		return err
	}
	old, err := benchdb.Open(source)
	if err != nil {
		return err
	}
	defer old.Close()
	db, err := sqldb.Open(destination)
	if err != nil {
		return err
	}
	defer db.Close()
	started := time.Now()
	expected := bindingDigest{}
	batch := make([]sqldb.Binding, 0, 2048)
	flush := func() error {
		if len(batch) == 0 {
			return nil
		}
		err := db.ImportBatch(ctx, batch)
		batch = batch[:0]
		return err
	}
	err = old.ExportBindings(ctx, func(scope string, p benchdb.Platform, r benchdb.Result) error {
		if err := expected.add(scope, p, r); err != nil {
			return err
		}
		batch = append(batch, sqldb.Binding{Scope: scope, Platform: p, Result: r})
		if len(batch) == cap(batch) {
			return flush()
		}
		return nil
	})
	if err != nil {
		return err
	}
	if err = flush(); err != nil {
		return err
	}
	metadata := map[string][32]byte{}
	err = old.ExportMetadata(ctx, func(key string, value []byte) error {
		metadata[key] = sha256.Sum256(value)
		return db.SetMetadata(ctx, "legacy/"+key, value)
	})
	if err != nil {
		return err
	}
	actual := bindingDigest{}
	if err = db.Export(ctx, actual.add); err != nil {
		return err
	}
	expectedHash, actualHash := expected.sum(), actual.sum()
	if len(expected.hashes) != len(actual.hashes) || expectedHash != actualHash {
		return fmt.Errorf("SQL migration mismatch: source=%d/%s destination=%d/%s", len(expected.hashes), expectedHash, len(actual.hashes), actualHash)
	}
	err = db.ExportMetadata(ctx, func(key string, value []byte) error {
		want, ok := metadata[key]
		if !ok || want != sha256.Sum256(value) {
			return fmt.Errorf("metadata mismatch: %s", key)
		}
		delete(metadata, key)
		return nil
	})
	if err != nil {
		return err
	}
	if len(metadata) != 0 {
		return fmt.Errorf("missing %d metadata records", len(metadata))
	}
	if err = db.Integrity(ctx); err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]any{"bindings": len(actual.hashes), "digest": actualHash, "output": destination, "elapsedSeconds": time.Since(started).Seconds(), "verified": true})
}
