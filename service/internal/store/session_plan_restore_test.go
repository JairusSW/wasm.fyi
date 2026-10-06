package store

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func TestRebuildRejectsLegacyJobOutsidePublishedPlan(t *testing.T) {
	for _, format := range []string{"indexed", "legacy"} {
		for _, dimension := range []string{"corpus", "machine", "plan", "pin"} {
			t.Run(format+"/"+dimension, func(t *testing.T) {
				root := t.TempDir()
				s := openTest(t, root)
				defer s.Close()
				job, objects := plannedFixture(t, "restore-scope", "local", "corpus-0001", true)
				first, e := s.Commit(stagePlannedFixture(t, s, job, objects))
				if e != nil {
					t.Fatal(e)
				}
				rev, e := s.Revision(first)
				if e != nil {
					t.Fatal(e)
				}
				// Build hash-consistent portable content whose completed legacy job omits
				// plan bytes. All source measurement exports remain unchanged. Recovery
				// must enforce the known scope instead of trusting this metadata alone.
				outside := job
				outside.SessionPlan = nil
				outside.Attempt = "legacy-outside"
				switch dimension {
				case "corpus":
					outside.Corpus = "corpus-outside"
				case "machine":
					outside.Machine = "outside"
				case "plan":
					outside.Plan = wire.Hash([]byte("other-plan"))
				case "pin":
					outside.ConfiguredHarnessPin = "other-pin"
				}
				id, e := s.put(outside)
				if e != nil {
					t.Fatal(e)
				}
				rev.Job, rev.Parent, rev.Created = id, first, rev.Created.Add(time.Hour)
				summary := jobSummary(outside, id, rev.Created)
				summaryID, e := s.put(summary)
				if e != nil {
					t.Fatal(e)
				}
				rev.Indexes, e = s.indexAdd(rev.Indexes, indexKey("published-job", "", ""), id, summaryID)
				if e != nil {
					t.Fatal(e)
				}
				rev.Indexes, e = s.indexAdd(rev.Indexes, indexKey("session-jobs", outside.Session, ""), publishedJobKey(summary), summaryID)
				if e != nil {
					t.Fatal(e)
				}
				if format == "legacy" {
					directory := map[string]string{}
					budget := ScanLimit
					if e := s.walk(rev.Indexes, &budget, func(k, v string) error {
						if k != indexKey("session-plan-scope", "", "") {
							directory[k] = v
						}
						return nil
					}); e != nil {
						t.Fatal(e)
					}
					rev.Indexes, e = s.mapSetMany(context.Background(), "", directory, 0)
					if e != nil {
						t.Fatal(e)
					}
				}
				invalid, e := s.put(rev)
				if e != nil {
					t.Fatal(e)
				}
				snapshot := filepath.Join(t.TempDir(), "portable")
				if e := os.MkdirAll(snapshot, 0700); e != nil {
					t.Fatal(e)
				}
				if e := os.CopyFS(filepath.Join(snapshot, "objects"), os.DirFS(filepath.Join(root, "objects"))); e != nil {
					t.Fatal(e)
				}
				pointer, _ := wire.Encode(portablePointer{Schema: 1, Current: invalid})
				if e := atomicFile(filepath.Join(snapshot, "published.json"), pointer, 0600); e != nil {
					t.Fatal(e)
				}
				destination := filepath.Join(t.TempDir(), "rebuilt")
				if e := Rebuild(snapshot, destination, "test"); e == nil {
					t.Fatal("out-of-scope legacy job survived DB-free recovery")
				}
				if _, e := os.Stat(destination); !os.IsNotExist(e) {
					t.Fatal("rejected recovery installed destination", e)
				}
			})
		}
	}
}
