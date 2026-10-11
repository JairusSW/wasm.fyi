package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/JairusSW/wasm.fyi/service/internal/benchdb"
	"github.com/JairusSW/wasm.fyi/service/internal/sqldb"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"os"
)

func runSQL(ctx context.Context, action, root, input, addr, assets string, readOnly bool, proxies string) error {
	if action != "serve" && action != "ingest" {
		return fmt.Errorf("%s is unavailable for SQL storage", action)
	}
	db, err := sqldb.Open(root)
	if err != nil {
		return err
	}
	defer db.Close()
	if action == "ingest" {
		if input == "" {
			return fmt.Errorf("ingest requires --input")
		}
		data, err := os.ReadFile(input)
		if err != nil {
			return err
		}
		if len(data) > wire.ResponseBytes {
			return fmt.Errorf("capture exceeds byte limit")
		}
		var capture benchdb.Capture
		if err = wire.Decode(data, &capture); err != nil {
			return err
		}
		id, err := db.Put(ctx, capture)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]string{"id": id})
	}
	return serveBenchmark(ctx, db, root, addr, assets, readOnly, proxies)
}

func removeSQLRevision(ctx context.Context, root, engine, revision string) error {
	db, err := sqldb.Open(root)
	if err != nil {
		return err
	}
	defer db.Close()
	result, err := db.RemoveRevision(ctx, engine, revision)
	if err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(result)
}
