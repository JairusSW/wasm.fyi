//go:build !linux && !darwin

package store

import "fmt"

func installDirectory(source, destination string) error {
	return fmt.Errorf("atomic non-replacing directory installation is unsupported on this platform")
}
