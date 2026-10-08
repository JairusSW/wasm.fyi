package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"log"
	"os"
	"sort"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}
func run() error {
	root := flag.String("data", "", "offline database")
	planPath := flag.String("plan", "", "retained history correction plan")
	flag.Parse()
	raw, err := os.ReadFile(*planPath)
	if err != nil {
		return err
	}
	var plan struct {
		Schema   int
		Revision string
		Jobs     map[string][]store.RetainedHistoryReport
	}
	if err = json.Unmarshal(raw, &plan); err != nil {
		return err
	}
	if plan.Schema != 1 {
		return fmt.Errorf("unknown correction schema")
	}
	s, err := store.OpenForOfflineMigration(*root, "retained-history-correction", store.DefaultLimits())
	if err != nil {
		return err
	}
	defer s.Close()
	s.EnableOfflineImport()
	// The plan is resumable: each correction has a content-addressed identity.
	if _, err = s.Revision(plan.Revision); err != nil {
		return err
	}
	ids := []string{}
	for id := range plan.Jobs {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for i, id := range ids {
		revision, err := s.CorrectRetainedHistory(context.Background(), id, plan.Jobs[id])
		if err != nil {
			return fmt.Errorf("job %s: %w", id, err)
		}
		if (i+1)%10 == 0 || i+1 == len(ids) {
			log.Printf("history bindings corrected: %d/%d revision=%s", i+1, len(ids), revision)
		}
	}
	fmt.Println(s.Current())
	return nil
}
