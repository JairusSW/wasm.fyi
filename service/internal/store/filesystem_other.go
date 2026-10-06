//go:build !linux && !darwin && !windows

package store

import "errors"

func filesystemBytes(string) (uint64, uint64, error) {
	return 0, 0, errors.New("filesystem capacity unsupported")
}
