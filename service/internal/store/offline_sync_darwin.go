//go:build darwin

package store

import (
	"os"
	"syscall"
)

// Darwin's File.Sync performs a drive-wide F_FULLFSYNC. During an offline
// batch, fsync sends each file's data to the drive first. flushOffline then
// calls syncDir (File.Sync/F_FULLFSYNC) after installing all directory entries,
// flushing all those writes to permanent storage before the root DB commit.
func syncOfflineFile(f *os.File) error {
	for {
		err := syscall.Fsync(int(f.Fd()))
		if err != syscall.EINTR {
			return err
		}
	}
}
