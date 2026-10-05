//go:build linux

package store

import "golang.org/x/sys/unix"

func installDirectory(source, destination string) error {
	return unix.Renameat2(unix.AT_FDCWD, source, unix.AT_FDCWD, destination, unix.RENAME_NOREPLACE)
}
