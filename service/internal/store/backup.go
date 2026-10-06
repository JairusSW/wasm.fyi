package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"github.com/cockroachdb/pebble/v2"
)

type BackupManifest struct {
	Schema  int           `json:"schema"`
	Current string        `json:"current"`
	Files   []wire.Object `json:"fileInventory"`
}
type backupFile struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Bytes  int64  `json:"bytes"`
}

func readRegular(fs *os.Root, name string, ceiling int64) ([]byte, error) {
	info, e := fs.Lstat(name)
	if e != nil {
		return nil, e
	}
	if !info.Mode().IsRegular() || info.Size() > ceiling {
		return nil, fmt.Errorf("invalid regular file")
	}
	f, e := fs.Open(name)
	if e != nil {
		return nil, e
	}
	defer f.Close()
	opened, e := f.Stat()
	if e != nil {
		return nil, e
	}
	if !os.SameFile(info, opened) {
		return nil, fmt.Errorf("file changed while opening")
	}
	b, e := io.ReadAll(io.LimitReader(f, ceiling+1))
	if e != nil {
		return nil, e
	}
	if int64(len(b)) > ceiling {
		return nil, fmt.Errorf("file exceeds ceiling")
	}
	return b, nil
}

// Copy, never link, so a checkpoint/backup does not share mutable inodes with
// the live store. The caller receives the exact stream digest and byte count.
// A backup/restore owns one buffer; copying is sequential and never retains it.
func copyRegular(ctx context.Context, src *os.Root, name, destination string, ceiling int64, buffer []byte) (backupFile, error) {
	out := backupFile{Path: name}
	if err := ctx.Err(); err != nil {
		return out, err
	}
	if len(buffer) == 0 {
		return out, fmt.Errorf("empty backup copy buffer")
	}
	info, e := src.Lstat(name)
	if e != nil {
		return out, e
	}
	if !info.Mode().IsRegular() || info.Size() > ceiling {
		return out, fmt.Errorf("invalid backup source file")
	}
	in, e := src.Open(name)
	if e != nil {
		return out, e
	}
	defer in.Close()
	opened, e := in.Stat()
	if e != nil {
		return out, e
	}
	if !os.SameFile(info, opened) {
		return out, fmt.Errorf("backup source changed")
	}
	if e = os.MkdirAll(filepath.Dir(destination), 0700); e != nil {
		return out, e
	}
	f, e := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		return out, e
	}
	defer f.Close()
	hash := sha256.New()
	limited := io.LimitReader(in, ceiling+1)
	for {
		if e = ctx.Err(); e != nil {
			return out, e
		}
		n, err := limited.Read(buffer)
		if n > 0 {
			out.Bytes += int64(n)
			if out.Bytes > ceiling {
				return out, fmt.Errorf("backup file exceeds ceiling")
			}
			if _, e = f.Write(buffer[:n]); e != nil {
				return out, e
			}
			hash.Write(buffer[:n])
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return out, err
		}
	}
	if out.Bytes != info.Size() {
		return out, fmt.Errorf("backup source size changed")
	}
	if e = f.Sync(); e != nil {
		return out, e
	}
	if e = f.Close(); e != nil {
		return out, e
	}
	out.SHA256 = hex.EncodeToString(hash.Sum(nil))
	return out, nil
}
func (s *Store) Backup(ctx context.Context, destination string) (BackupManifest, error) {
	manifest := BackupManifest{Schema: 1, Files: []wire.Object{}}
	if e := s.publish.LockContext(ctx); e != nil {
		return manifest, e
	}
	defer s.publish.Unlock()
	manifest.Current = s.Current()
	if e := ctx.Err(); e != nil {
		return manifest, e
	}
	if s.poisoned.Load() {
		return manifest, ErrNeedsRestart
	}
	if _, e := os.Lstat(destination); e == nil {
		return manifest, fmt.Errorf("backup destination exists")
	} else if !os.IsNotExist(e) {
		return manifest, e
	}
	marked, required, e := s.backupReachability(ctx)
	if e != nil {
		return manifest, e
	}
	parent := filepath.Dir(destination)
	temp, e := os.MkdirTemp(parent, ".backup-")
	if e != nil {
		return manifest, e
	}
	defer os.RemoveAll(temp)
	if e = os.Mkdir(filepath.Join(temp, "objects"), 0700); e != nil {
		return manifest, e
	}
	// Checkpoint metadata and immutable content describe the same serialized
	// publication state. Uploads may complete during copying, but cannot publish.
	if e = s.db.Checkpoint(filepath.Join(temp, "checkpoint"), pebble.WithFlushedWAL()); e != nil {
		return manifest, e
	}
	// Detach the checkpoint from the live database's hardlinks before keeping it.
	checkpoint, e := os.OpenRoot(filepath.Join(temp, "checkpoint"))
	if e != nil {
		return manifest, e
	}
	defer checkpoint.Close()
	files := []backupFile{}
	copyBuffer := make([]byte, 128*1024)
	e = filepath.WalkDir(filepath.Join(temp, "checkpoint"), func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlink in checkpoint")
		}
		if entry.IsDir() {
			return nil
		}
		relative, e := filepath.Rel(filepath.Join(temp, "checkpoint"), path)
		if e != nil {
			return e
		}
		record, e := copyRegular(ctx, checkpoint, relative, filepath.Join(temp, "db", relative), 16<<30, copyBuffer)
		if e != nil {
			return e
		}
		record.Path = filepath.ToSlash(filepath.Join("db", relative))
		files = append(files, record)
		return nil
	})
	if e != nil {
		return manifest, e
	}
	checkpoint.Close()
	if e = os.RemoveAll(filepath.Join(temp, "checkpoint")); e != nil {
		return manifest, e
	}
	objects := make([]string, 0, len(marked))
	for id := range marked {
		objects = append(objects, id)
	}
	sort.Strings(objects)
	for _, id := range objects {
		record, e := copyRegular(ctx, s.objects, id, filepath.Join(temp, "objects", id), wire.BlobBytes, copyBuffer)
		if e != nil {
			if os.IsNotExist(e) && !required[id] {
				continue
			}
			return manifest, e
		}
		if record.SHA256 != id {
			return manifest, fmt.Errorf("copied object digest mismatch")
		}
		record.Path = "objects/" + id
		files = append(files, record)
	}
	source, e := os.OpenRoot(s.root)
	if e != nil {
		return manifest, e
	}
	defer source.Close()
	pointer, _ := wire.Encode(portablePointer{Schema: 1, Current: manifest.Current, Registrations: s.registrationRoot(), Overviews: s.overviewRoot()})
	if e = atomicFile(filepath.Join(temp, "published.json"), pointer, 0600); e != nil {
		return manifest, e
	}
	files = append(files, backupFile{"published.json", wire.Hash(pointer), int64(len(pointer))})
	if info, e := source.Lstat("cursor.key"); e == nil {
		if !info.Mode().IsRegular() || info.Size() != 32 {
			return manifest, fmt.Errorf("invalid cursor secret")
		}
		record, e := copyRegular(ctx, source, "cursor.key", filepath.Join(temp, "cursor.key"), 32, copyBuffer)
		if e != nil {
			return manifest, e
		}
		files = append(files, record)
	} else if !os.IsNotExist(e) {
		return manifest, e
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Path < files[j].Path })
	if e = os.Mkdir(filepath.Join(temp, "inventory"), 0700); e != nil {
		return manifest, e
	}
	for start := 0; start < len(files); start += 1000 {
		end := start + 1000
		if end > len(files) {
			end = len(files)
		}
		b, e := wire.Encode(files[start:end])
		if e != nil {
			return manifest, e
		}
		if len(b) > wire.ChunkBytes {
			return manifest, ErrLimit
		}
		id := wire.Hash(b)
		if e = atomicFile(filepath.Join(temp, "inventory", id), b, 0600); e != nil {
			return manifest, e
		}
		manifest.Files = append(manifest.Files, wire.Object{SHA256: id, Bytes: len(b), Kind: "inventory"})
		if len(manifest.Files) > 512 {
			return manifest, ErrLimit
		}
	}
	b, e := wire.Encode(manifest)
	if e != nil {
		return manifest, e
	}
	if e = atomicFile(filepath.Join(temp, "backup.json"), b, 0600); e != nil {
		return manifest, e
	}
	// Sync nested directories before the final atomic directory installation.
	directories := []string{}
	e = filepath.WalkDir(temp, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			directories = append(directories, path)
		}
		return nil
	})
	if e != nil {
		return manifest, e
	}
	for i := len(directories) - 1; i >= 0; i-- {
		if e = syncDir(directories[i]); e != nil {
			return manifest, e
		}
	}
	if e = ctx.Err(); e != nil {
		return manifest, e
	}
	if e = installDirectory(temp, destination); e != nil {
		return manifest, e
	}
	return manifest, syncDir(parent)
}

// Verification checks every declared file, exact inventories, and the complete
// portable evidence closure. A database checkpoint alone is never sufficient.
func VerifyBackup(ctx context.Context, source string) (BackupManifest, error) {
	var manifest BackupManifest
	fs, e := os.OpenRoot(source)
	if e != nil {
		return manifest, e
	}
	defer fs.Close()
	b, e := readRegular(fs, "backup.json", wire.ChunkBytes)
	if e != nil {
		return manifest, e
	}
	if e = wire.Decode(b, &manifest); e != nil {
		return manifest, e
	}
	if manifest.Schema != 1 || len(manifest.Files) > 512 || manifest.Current != "" && !wire.IsHash(manifest.Current) {
		return manifest, fmt.Errorf("invalid backup manifest")
	}
	paths := map[string]bool{"backup.json": true}
	buffer := make([]byte, 128*1024)
	for _, inventory := range manifest.Files {
		if !wire.IsHash(inventory.SHA256) || inventory.Kind != "inventory" || inventory.Bytes > wire.ChunkBytes || inventory.Bytes <= 0 {
			return manifest, fmt.Errorf("invalid backup inventory")
		}
		name := "inventory/" + inventory.SHA256
		if paths[name] {
			return manifest, fmt.Errorf("duplicate inventory")
		}
		paths[name] = true
		b, e := readRegular(fs, name, wire.ChunkBytes)
		if e != nil {
			return manifest, e
		}
		if len(b) != inventory.Bytes || wire.Hash(b) != inventory.SHA256 {
			return manifest, fmt.Errorf("backup inventory digest differs")
		}
		var files []backupFile
		if e = wire.Decode(b, &files); e != nil {
			return manifest, e
		}
		if len(files) > 1000 {
			return manifest, ErrLimit
		}
		for _, record := range files {
			if e = ctx.Err(); e != nil {
				return manifest, e
			}
			if !safeBackupPath(record.Path) || paths[record.Path] || !wire.IsHash(record.SHA256) || record.Bytes < 0 || record.Bytes > 16<<30 {
				return manifest, fmt.Errorf("invalid backup file reference")
			}
			paths[record.Path] = true
			info, e := fs.Lstat(record.Path)
			if e != nil {
				return manifest, e
			}
			if !info.Mode().IsRegular() || info.Size() != record.Bytes {
				return manifest, fmt.Errorf("backup file unavailable or size differs")
			}
			f, e := fs.Open(record.Path)
			if e != nil {
				return manifest, e
			}
			opened, e := f.Stat()
			if e != nil || !os.SameFile(info, opened) {
				f.Close()
				return manifest, fmt.Errorf("backup file changed")
			}
			h := sha256.New()
			for {
				if e = ctx.Err(); e != nil {
					f.Close()
					return manifest, e
				}
				n, err := f.Read(buffer)
				if n > 0 {
					h.Write(buffer[:n])
				}
				if err == io.EOF {
					break
				}
				if err != nil {
					f.Close()
					return manifest, err
				}
			}
			f.Close()
			if hex.EncodeToString(h.Sum(nil)) != record.SHA256 {
				return manifest, fmt.Errorf("backup file digest differs")
			}
		}
	}
	e = filepath.WalkDir(source, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("backup contains symlink")
		}
		if entry.IsDir() {
			return nil
		}
		name, e := filepath.Rel(source, path)
		if e != nil {
			return e
		}
		if !paths[filepath.ToSlash(name)] {
			return fmt.Errorf("backup contains unlisted file")
		}
		return nil
	})
	if e != nil {
		return manifest, e
	}
	pointer, e := readRegular(fs, "published.json", 4096)
	if e != nil {
		return manifest, e
	}
	var p portablePointer
	if e = wire.Decode(pointer, &p); e != nil {
		return manifest, e
	}
	if p.Schema != 1 || p.Current != manifest.Current {
		return manifest, fmt.Errorf("backup pointer differs")
	}
	if e = verifyPortable(source); e != nil {
		return manifest, e
	}
	return manifest, nil
}
func safeBackupPath(path string) bool {
	if path == "published.json" || path == "cursor.key" {
		return true
	}
	if filepath.IsAbs(path) || filepath.ToSlash(filepath.Clean(path)) != path || strings.ContainsAny(path, "\\\x00") {
		return false
	}
	parts := strings.Split(path, "/")
	if len(parts) < 2 {
		return false
	}
	for _, part := range parts {
		if part == "" || part == "." || part == ".." {
			return false
		}
	}
	if parts[0] == "objects" {
		return len(parts) == 2 && wire.IsHash(parts[1])
	}
	return parts[0] == "db"
}
func Restore(ctx context.Context, backup, destination, publisher string) error {
	if _, e := VerifyBackup(ctx, backup); e != nil {
		return e
	}
	if _, e := os.Lstat(destination); e == nil {
		return fmt.Errorf("restore destination exists")
	} else if !os.IsNotExist(e) {
		return e
	}
	parent := filepath.Dir(destination)
	temp, e := os.MkdirTemp(parent, ".restore-")
	if e != nil {
		return e
	}
	defer os.RemoveAll(temp)
	fs, e := os.OpenRoot(backup)
	if e != nil {
		return e
	}
	defer fs.Close()
	copyBuffer := make([]byte, 128*1024)
	e = filepath.WalkDir(backup, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlink in restore source")
		}
		if entry.IsDir() {
			return nil
		}
		name, e := filepath.Rel(backup, path)
		if e != nil {
			return e
		}
		_, e = copyRegular(ctx, fs, filepath.ToSlash(name), filepath.Join(temp, name), 16<<30, copyBuffer)
		return e
	})
	if e != nil {
		return e
	}
	// Verify the detached copy too: the source may have changed during copying.
	if _, e = VerifyBackup(ctx, temp); e != nil {
		return e
	}
	restored, e := Open(temp, publisher)
	if e != nil {
		return e
	}
	if e = restored.Close(); e != nil {
		return e
	}
	if e = os.RemoveAll(filepath.Join(temp, "inventory")); e != nil {
		return e
	}
	if e = os.Remove(filepath.Join(temp, "backup.json")); e != nil {
		return e
	}
	if e = syncDir(temp); e != nil {
		return e
	}
	if e = installDirectory(temp, destination); e != nil {
		return e
	}
	return syncDir(parent)
}
