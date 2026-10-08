//go:build !darwin

package store

import "os"

func syncOfflineFile(f *os.File) error { return f.Sync() }
