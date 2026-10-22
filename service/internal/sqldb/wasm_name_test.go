package sqldb

import (
	"context"
	"fmt"
	"github.com/JairusSW/wasm.fyi/service/internal/benchdb"
	"testing"
)

func TestCrossMachineWasmNames(t *testing.T) {
	ctx := context.Background()
	for _, backend := range []string{"sql", "legacy"} {
		t.Run(backend, func(t *testing.T) {
			var put func(context.Context, benchdb.Capture) (string, error)
			var export func(context.Context, func(string, benchdb.Platform, benchdb.Result) error) error
			if backend == "sql" {
				db, err := Open(t.TempDir())
				if err != nil {
					t.Fatal(err)
				}
				defer db.Close()
				put = db.Put
				export = db.Export
			} else {
				db, err := benchdb.Open(t.TempDir())
				if err != nil {
					t.Fatal(err)
				}
				defer db.Close()
				put = db.Put
				export = db.ExportBindings
			}
			c := fixture()
			if _, err := put(ctx, c); err != nil {
				t.Fatal(err)
			}
			c.Platform.Arch = "arm64"
			c.Results[0].Wasm = "friendly-source-name.wasm"
			if _, err := put(ctx, c); err != nil {
				t.Fatal("valid filename alias rejected", err)
			}
			seen := map[string]string{}
			if err := export(ctx, func(scope string, p benchdb.Platform, r benchdb.Result) error {
				if scope == "latest" {
					seen[p.Arch] = r.Wasm
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			if seen["amd64"] != "test.wasm" || seen["arm64"] != "friendly-source-name.wasm" {
				t.Fatal("original names lost", seen)
			}
			c.Results[0].Artifact = fmt.Sprintf("%064x", 99)
			if _, err := put(ctx, c); err == nil {
				t.Fatal("conflicting artifact accepted")
			}
		})
	}
}
