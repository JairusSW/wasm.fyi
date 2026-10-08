package store

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// EnableOfflineImport enables a single offline writer to stage immutable bytes
// under private temporary names. It must never be enabled on a serving store.
// Publication syncs and installs all staged files before the durable root commit.
func (s *Store) EnableOfflineImport() {
	s.offlineMu.Lock()
	defer s.offlineMu.Unlock()
	s.offline = true
	s.offlineFiles = map[string]string{}
	s.offlineDerived = map[string]offlineMetadata{}
	s.offlineInputs = map[string]bool{}
}
func (s *Store) offlinePath(id string) string {
	s.offlineMu.RLock()
	defer s.offlineMu.RUnlock()
	if path := s.offlineFiles[id]; path != "" {
		return path
	}
	return id
}
func (s *Store) stageOffline(id, path string) {
	s.offlineMu.Lock()
	s.offlineFiles[id] = path
	s.offlineMu.Unlock()
}
func (s *Store) flushOffline(roots ...string) error {
	if err := s.pruneOfflineNodes(roots); err != nil {
		return err
	}
	s.offlineMu.RLock()
	active := s.offline
	files := make(map[string]string, len(s.offlineFiles))
	for id, path := range s.offlineFiles {
		files[id] = path
	}
	s.offlineMu.RUnlock()
	if !active || len(files) == 0 {
		return nil
	}
	type item struct{ id, path string }
	queue := make(chan item)
	errors := make(chan error, 4)
	var workers sync.WaitGroup
	for i := 0; i < 4; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for file := range queue {
				f, err := s.objects.Open(file.path)
				if err == nil {
					err = syncOfflineFile(f)
					closeErr := f.Close()
					if err == nil {
						err = closeErr
					}
				}
				if err != nil {
					errors <- err
					return
				}
				if file.path != file.id {
					if err = os.Link(filepath.Join(s.root, "objects", file.path), filepath.Join(s.root, "objects", file.id)); err != nil {
						errors <- fmt.Errorf("install staged object: %w", err)
						return
					}
					s.stageOffline(file.id, file.id)
					if err = s.objects.Remove(file.path); err != nil {
						errors <- err
						return
					}
				}
			}
		}()
	}
	done := make(chan struct{})
	go func() { workers.Wait(); close(done) }()
	for id, path := range files {
		select {
		case queue <- item{id, path}:
		case err := <-errors:
			close(queue)
			<-done
			return err
		}
	}
	close(queue)
	<-done
	select {
	case err := <-errors:
		return err
	default:
	}
	if err := syncDir(filepath.Join(s.root, "objects")); err != nil {
		return err
	}
	s.offlineMu.Lock()
	for id := range files {
		delete(s.offlineFiles, id)
		delete(s.offlineDerived, id)
		delete(s.offlineInputs, id)
	}
	s.offlineMu.Unlock()
	return nil
}
