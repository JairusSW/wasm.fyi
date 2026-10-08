// audit-retained checks every legacy evidence file against the published DB.
// Run only after the offline migration writer has closed its destination.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

type source struct {
	Path     string `json:"path"`
	Producer string `json:"producerProjection"`
	Sealed   string `json:"sealedReport"`
}
type mapping struct {
	ReportID string `json:"reportId"`
}

func readJSON(path string, v any) error {
	b, e := os.ReadFile(path)
	if e != nil {
		return e
	}
	return json.Unmarshal(b, v)
}
func run() error {
	root := flag.String("data", "", "completed offline data directory")
	inventoryPath := flag.String("inventory", ".wasmbench/retained-api-inventory.json", "retained inventory")
	checkpointPath := flag.String("checkpoint", "", "completed checkpoint")
	flag.Parse()
	var inventory struct {
		Reports []source `json:"reports"`
	}
	if e := readJSON(*inventoryPath, &inventory); e != nil {
		return e
	}
	var state struct {
		Complete         bool               `json:"complete"`
		Reports          map[string]mapping `json:"reports"`
		Parents          map[string]mapping `json:"parents"`
		Revision         string             `json:"revision"`
		MetadataReportID string             `json:"metadataReportId"`
	}
	if e := readJSON(*checkpointPath, &state); e != nil {
		return e
	}
	if !state.Complete || len(state.Reports) != len(inventory.Reports) || state.MetadataReportID == "" {
		return fmt.Errorf("migration checkpoint is incomplete")
	}
	s, e := store.Open(*root, "retained-audit")
	if e != nil {
		return e
	}
	defer s.Close()
	if s.Current() != state.Revision {
		return fmt.Errorf("checkpoint revision differs from published DB")
	}
	revision := s.Current()
	ctx := context.Background()
	checked, attachments := 0, 0
	for _, source := range inventory.Reports {
		oldID := strings.TrimSuffix(filepath.Base(source.Path), ".json")
		entry, ok := state.Reports[oldID]
		if !ok {
			return fmt.Errorf("missing mapping: %s", oldID)
		}
		files, e := s.ReportFiles(ctx, revision, entry.ReportID)
		if e != nil {
			return e
		}
		byName := map[string]wire.ReportFile{}
		for _, r := range files {
			f, e := wire.ReportFileData(r.Data)
			if e != nil {
				return e
			}
			byName[f.Name] = f
		}
		expected := map[string]string{"retained-site-report.json": source.Path}
		var legacy struct {
			Trials     string `json:"trialsEvidence"`
			Throughput string `json:"throughputEvidence"`
		}
		if e = readJSON(source.Path, &legacy); e != nil {
			return e
		}
		if legacy.Trials != "" {
			expected["retained-trials.json"] = filepath.Join(filepath.Dir(source.Path), legacy.Trials)
		}
		if legacy.Throughput != "" {
			expected["retained-throughput.json"] = filepath.Join(filepath.Dir(source.Path), legacy.Throughput)
		}
		producer := source.Producer
		if producer == "" {
			producer = source.Sealed
		}
		for name, path := range map[string]string{"retained-producer-data.json": "data.json", "retained-producer-checksums.json": "checksums.json", "retained-receipt.json": "wasm-fyi-export.json"} {
			full := filepath.Join(producer, path)
			if _, err := os.Stat(full); err == nil {
				expected[name] = full
			} else if !os.IsNotExist(err) {
				return err
			}
		}
		for name, path := range expected {
			f, ok := byName[name]
			if !ok {
				return fmt.Errorf("report %s lacks %s", oldID, name)
			}
			b, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			if wire.Hash(b) != f.SHA256 || int64(len(b)) != f.Bytes {
				return fmt.Errorf("source parity differs: %s/%s", oldID, name)
			}
			attachments++
		}
		checked++
		if checked%1000 == 0 {
			fmt.Fprintf(os.Stderr, "verified %d retained reports\n", checked)
		}
	}
	for key, parent := range state.Parents {
		files, e := s.ReportFiles(ctx, revision, parent.ReportID)
		if e != nil {
			return e
		}
		var index struct {
			SHA256 string `json:"sha256"`
			Bytes  int64  `json:"bytes"`
		}
		if e = readJSON(filepath.Join("data/benchmark-runs", key, "bundle/index.json"), &index); e != nil {
			return e
		}
		found := false
		for _, r := range files {
			f, e := wire.ReportFileData(r.Data)
			if e != nil {
				return e
			}
			if f.Name == "retained-parent.tar.gz" {
				found = f.SHA256 == index.SHA256 && f.Bytes == index.Bytes
			}
		}
		if !found {
			return fmt.Errorf("parent archive missing or changed: %s", key)
		}
	}
	page, e := s.CatalogPage(ctx, revision, "report", 0, 1)
	if e != nil {
		return e
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]any{"revision": revision, "retainedReports": checked, "exactSourceFiles": attachments, "parentBundles": len(state.Parents), "catalogReports": page.Total})
}
func main() {
	if e := run(); e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
}
