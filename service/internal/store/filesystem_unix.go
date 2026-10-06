//go:build linux || darwin

package store

import (
	"fmt"
	"golang.org/x/sys/unix"
	"math"
)

func filesystemBytes(path string) (uint64, uint64, error) {
	var info unix.Statfs_t
	if e := unix.Statfs(path, &info); e != nil {
		return 0, 0, e
	}
	if info.Bsize <= 0 {
		return 0, 0, fmt.Errorf("invalid filesystem block size")
	}
	size := uint64(info.Bsize)
	if uint64(info.Bavail) > math.MaxUint64/size || uint64(info.Blocks) > math.MaxUint64/size {
		return 0, 0, fmt.Errorf("filesystem size exceeds representation")
	}
	return uint64(info.Bavail) * size, uint64(info.Blocks) * size, nil
}
