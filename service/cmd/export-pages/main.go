// export-pages prepares small initial views from the published database.
// Run while the serving process is stopped (Pebble owns its directory lock).
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/api"
	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}
func run() error {
	root := flag.String("data", ".wasmfyi", "published database directory")
	output := flag.String("output", ".wasmfyi/page-seeds", "generated page directory")
	flag.Parse()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	s, err := store.OpenForReadOnlyServing(*root, "local-page-export", store.DefaultLimits())
	if err != nil {
		return err
	}
	defer s.Close()
	revision := s.Current()
	if !wire.IsHash(revision) {
		return fmt.Errorf("no published revision")
	}
	key, err := s.CursorKey()
	if err != nil {
		return err
	}
	builder := api.NewPageBuilder(s, key)
	if err = s.PrepareHistoryReadIndex(ctx, filepath.Join(*output, "history-index"), func(stage string, count int) { log.Printf("history serving index %s: %d", stage, count) }); err != nil {
		return err
	}
	environments, err := builder.DisplayCatalog(ctx, "environment")
	if err != nil {
		return err
	}
	if err = builder.PrepareHistoryReferences(ctx, filepath.Join(*output, "history-index"), environments, func(scope, rows int) { log.Printf("history reference scope %d prepared: %d rows", scope, rows) }); err != nil {
		return err
	}
	preparedIndex, err := store.OpenHistoryReadIndex(filepath.Join(*output, "history-index"), revision)
	if err != nil {
		return err
	}
	defer preparedIndex.Close()
	s.EnablePreparedSelections(preparedIndex)
	defer s.EnablePreparedSelections(nil)
	updateStatistics := func(seed api.PageSeed) error {
		stats, e := builder.Statistics(ctx, seed.Catalogs["environments"])
		if e != nil {
			return e
		}
		for _, name := range []string{"home.json", "benchmarks.json"} {
			path := filepath.Join(*output, name)
			raw, e := os.ReadFile(path)
			if e != nil {
				return e
			}
			var page api.PageSeed
			if e = json.Unmarshal(raw, &page); e != nil {
				return e
			}
			page.Statistics = &stats
			raw, e = json.Marshal(page)
			if e != nil {
				return e
			}
			if len(raw) > wire.ResponseBytes {
				return fmt.Errorf("updated page exceeds byte ceiling")
			}
			if e = os.WriteFile(path+".tmp", raw, 0600); e != nil {
				return e
			}
			if e = os.Rename(path+".tmp", path); e != nil {
				return e
			}
		}
		log.Printf("timing sample statistics prepared: %+v", stats)
		return nil
	}
	prepare := func(seed api.PageSeed) error {
		raw, err := builder.PreparedResults(ctx, seed)
		if err != nil {
			return err
		}
		path := filepath.Join(*output, "prepared-results.json")
		if err = os.WriteFile(path+".tmp", raw, 0600); err != nil {
			return err
		}
		if err = os.Rename(path+".tmp", path); err != nil {
			return err
		}
		return os.WriteFile(path+".sha256", []byte(wire.Hash(raw)), 0600)
	}
	if old, e := os.ReadFile(filepath.Join(*output, "benchmarks.json")); e == nil {
		var seed api.PageSeed
		home, e := os.ReadFile(filepath.Join(*output, "home.json"))
		var homeSeed api.PageSeed
		if e == nil && json.Unmarshal(home, &homeSeed) == nil && json.Unmarshal(old, &seed) == nil && seed.Schema == 1 && seed.Revision == revision && homeSeed.Revision == revision {
			if seed.Statistics == nil || homeSeed.Statistics == nil || seed.Statistics.TimingSamplePolicy != api.TimingSamplePolicy {
				if e = updateStatistics(seed); e != nil {
					return e
				}
			}
			cache, e := os.ReadFile(filepath.Join(*output, "prepared-results.json"))
			digest, _ := os.ReadFile(filepath.Join(*output, "prepared-results.json.sha256"))
			var stamp struct{ Revision string }
			_ = json.Unmarshal(cache, &stamp)
			if e == nil && stamp.Revision == revision && wire.Hash(cache) == string(digest) {
				log.Printf("page data already prepared for %s", revision)
				return nil
			}
			log.Printf("preparing server-side table selection for %s", revision)
			return prepare(seed)
		}
	}
	catalogs := map[string][]wire.Record{}
	for _, kind := range []string{"environment", "track", "workload"} {
		items, err := builder.DisplayCatalog(ctx, kind)
		if err != nil {
			return err
		}
		catalogs[kind+"s"] = items
	}
	groups := map[string][]string{}
	for _, r := range catalogs["environments"] {
		var d struct {
			OS, Arch, Hostname string
			CPU                string `json:"cpu_description"`
		}
		if err = json.Unmarshal(r.Data, &d); err != nil {
			return err
		}
		if d.OS != "linux" {
			continue
		}
		raw, _ := json.Marshal(d)
		groups[string(raw)] = append(groups[string(raw)], r.ID)
	}
	if len(groups) != 1 {
		return fmt.Errorf("expected one physical Linux default host, found %d", len(groups))
	}
	var members []string
	for _, ids := range groups {
		members = ids
	}
	sort.Strings(members)
	log.Printf("preparing default view for %s (%d environment members)", revision, len(members))
	seed, err := builder.DefaultPage(ctx, "m1", members[0], members, catalogs, true)
	if err != nil {
		return err
	}
	if err = os.MkdirAll(*output, 0700); err != nil {
		return err
	}
	write := func(name string, seed api.PageSeed) error {
		raw, err := json.Marshal(seed)
		if err != nil {
			return err
		}
		if len(raw) > wire.ResponseBytes {
			return fmt.Errorf("%s exceeds 1 MiB page ceiling (%d)", name, len(raw))
		}
		tmp := filepath.Join(*output, name+".tmp")
		if err = os.WriteFile(tmp, raw, 0600); err != nil {
			return err
		}
		if err = os.Rename(tmp, filepath.Join(*output, name)); err != nil {
			return err
		}
		log.Printf("%s: %d decoded bytes", name, len(raw))
		return nil
	}
	if err = write("benchmarks.json", seed); err != nil {
		return err
	}
	if err = prepare(seed); err != nil {
		return err
	}
	seed.Matrix = nil
	delete(seed.Overviews, "inst")
	delete(seed.Overviews, "first")
	if err = write("home.json", seed); err != nil {
		return err
	}
	return updateStatistics(seed)
}
