// import-retained is an offline migration writer. It never executes a producer
// or archived tools; the caller supplies bounded, integrity-labelled exports.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"os"
	"path/filepath"
)

func run() error {
	root := flag.String("data", "", "offline data directory")
	flag.Parse()
	if *root == "" {
		return fmt.Errorf("--data required")
	}
	limits := store.DefaultLimits()
	// A bounded archival batch can include shared tool/report archives larger
	// than the online publisher admission allowance. This offline command owns
	// the destination exclusively; normal serving limits remain unchanged.
	limits.PendingBytes = 8 << 30
	s, err := store.OpenForOfflineMigration(*root, "local-retained-migration", limits)
	if err != nil {
		return err
	}
	defer s.Close()
	s.EnableOfflineImport()
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 64*1024), 2*1024*1024)
	for scanner.Scan() {
		var message struct {
			Job         wire.Job `json:"job"`
			Directories []string `json:"directories"`
		}
		if err = wire.Decode(scanner.Bytes(), &message); err != nil {
			return err
		}
		if message.Job.Kind != "retained-measurement" && message.Job.Kind != "retained-history" || len(message.Directories) > 64 {
			return fmt.Errorf("retained measurement jobs only")
		}
		if err = message.Job.Validate(); err != nil {
			return err
		}
		discardedBefore := s.OfflineDiscardedIndexPages()
		id, err := s.Submit(message.Job)
		if err != nil {
			return err
		}
		for index, directory := range message.Directories {
			fs, err := os.OpenRoot(filepath.Join(directory, "objects"))
			if err != nil {
				return err
			}
			entries, err := os.ReadDir(filepath.Join(directory, "objects"))
			if err != nil {
				fs.Close()
				return err
			}
			for _, entry := range entries {
				if entry.IsDir() || !wire.IsHash(entry.Name()) {
					fs.Close()
					return fmt.Errorf("invalid export object filename")
				}
				f, err := fs.Open(entry.Name())
				if err != nil {
					fs.Close()
					return err
				}
				err = s.InstallBinary(entry.Name(), f)
				f.Close()
				if err != nil {
					fs.Close()
					return err
				}
			}
			fs.Close()
			// Expand committed inventory pages after their verified bytes are installed.
			for _, export := range message.Job.Exports[index : index+1] {
				for _, page := range export.Manifest.InventoryPages {
					if err = s.AttachInventoryContext(context.Background(), id, page.SHA256); err != nil {
						return err
					}
				}
			}
		}
		revision, err := s.CommitContext(context.Background(), id)
		if err != nil {
			return err
		}
		if err = json.NewEncoder(os.Stdout).Encode(map[string]any{"id": id, "revision": revision, "prunedIndexPages": s.OfflineDiscardedIndexPages() - discardedBefore}); err != nil {
			return err
		}
	}
	return scanner.Err()
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
