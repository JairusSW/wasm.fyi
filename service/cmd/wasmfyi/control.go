package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
)

// The control plane is local filesystem authority, separate from publisher HTTP.
// Its containing directory must be private; existing paths are never replaced.
type controlServer struct {
	server   *http.Server
	listener *net.UnixListener
	path     string
	info     os.FileInfo
	done     chan error
	once     sync.Once
}

type maintenanceRequest struct {
	Output string `json:"output,omitempty"`
	Apply  bool   `json:"apply,omitempty"`
}

func startControl(ctx context.Context, path string, s *store.Store) (*controlServer, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	parent := filepath.Dir(absolute)
	info, err := os.Lstat(parent)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() || info.Mode().Perm()&0077 != 0 {
		return nil, fmt.Errorf("control socket requires a private directory (mode 0700)")
	}
	resolved, err := filepath.EvalSymlinks(parent)
	if err != nil {
		return nil, err
	}
	path = filepath.Join(resolved, filepath.Base(absolute))
	if _, err = os.Lstat(path); err == nil {
		return nil, fmt.Errorf("control socket path already exists")
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
	if err != nil {
		return nil, err
	}
	listener.SetUnlinkOnClose(false)
	info, err = os.Lstat(path)
	if err != nil {
		listener.Close()
		return nil, err
	}
	c := &controlServer{listener: listener, path: path, info: info, done: make(chan error, 1)}
	if err = os.Chmod(path, 0600); err != nil {
		c.Close()
		return nil, err
	}
	slots := make(chan struct{}, 1)
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || (r.URL.Path != "/backup" && r.URL.Path != "/gc") || r.URL.RawQuery != "" {
			http.Error(w, "unknown maintenance operation", http.StatusNotFound)
			return
		}
		select {
		case slots <- struct{}{}:
			defer func() { <-slots }()
		default:
			http.Error(w, "maintenance operation in progress", http.StatusConflict)
			return
		}
		release, err := s.Lease()
		if err != nil {
			http.Error(w, "store unavailable", http.StatusServiceUnavailable)
			return
		}
		defer release()
		var request maintenanceRequest
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192))
		decoder.DisallowUnknownFields()
		if err = decoder.Decode(&request); err != nil {
			http.Error(w, "invalid maintenance request", http.StatusBadRequest)
			return
		}
		if err = decoder.Decode(new(any)); err != io.EOF {
			http.Error(w, "invalid maintenance request", http.StatusBadRequest)
			return
		}
		var result any
		if r.URL.Path == "/backup" {
			if request.Output == "" || !filepath.IsAbs(request.Output) || request.Apply {
				http.Error(w, "backup requires an absolute output path", http.StatusBadRequest)
				return
			}
			result, err = s.Backup(r.Context(), request.Output)
		} else {
			if request.Output != "" {
				http.Error(w, "gc does not accept output", http.StatusBadRequest)
				return
			}
			result, err = s.GC(r.Context(), store.GCOptions{Apply: request.Apply, Grace: 24 * time.Hour, QuarantineGrace: 7 * 24 * time.Hour})
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(result)
	})
	c.server = &http.Server{Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, IdleTimeout: 10 * time.Second, MaxHeaderBytes: 8192, BaseContext: func(net.Listener) context.Context { return ctx }}
	go func() { c.done <- c.server.Serve(listener) }()
	return c, nil
}

func (c *controlServer) Close() {
	c.once.Do(func() {
		if c.server != nil {
			_ = c.server.Close()
			<-c.done
		} else {
			_ = c.listener.Close()
		}
		// Do not remove a replacement path installed by another local operation.
		if info, err := os.Lstat(c.path); err == nil && os.SameFile(info, c.info) {
			_ = os.Remove(c.path)
		}
	})
}

func callControl(ctx context.Context, socket, action, output string, apply bool, destination io.Writer) error {
	if action != "backup" && action != "gc" {
		return fmt.Errorf("--control is only valid for backup or gc")
	}
	if output != "" {
		var err error
		output, err = filepath.Abs(output)
		if err != nil {
			return err
		}
	}
	body, err := json.Marshal(maintenanceRequest{Output: output, Apply: apply})
	if err != nil {
		return err
	}
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, "unix", socket)
	}, DisableKeepAlives: true}
	defer transport.CloseIdleConnections()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, "http://local/"+action, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := (&http.Client{Transport: transport}).Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, (1<<20)+1))
	if err != nil {
		return err
	}
	if len(data) > 1<<20 {
		return errors.New("maintenance response exceeds limit")
	}
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("maintenance failed (%d): %s", response.StatusCode, bytes.TrimSpace(data))
	}
	if !json.Valid(data) {
		return errors.New("invalid maintenance response")
	}
	_, err = destination.Write(data)
	return err
}
