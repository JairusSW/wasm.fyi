package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/api"
	"github.com/JairusSW/wasm.fyi/service/internal/frontend"
)

func previewIdentity(data string) (localIdentity, bool) {
	i, e := readLocalIdentity(filepath.Join(data, "runtime", "preview.json"))
	return i, e == nil && i.Data == data && localIdentityAlive(i)
}
func ensureLocalPreview(ctx context.Context, o localOptions) (string, error) {
	if i, ok := previewIdentity(o.Data); ok {
		return i.URL, nil
	}
	if err := os.MkdirAll(filepath.Join(o.Data, "runtime"), 0700); err != nil {
		return "", err
	}
	binary, err := os.Executable()
	if err != nil {
		return "", err
	}
	log, err := os.OpenFile(filepath.Join(o.Data, "runtime", "preview.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return "", err
	}
	defer log.Close()
	args := []string{"serve", "--data", o.Data, "--cache", o.Cache, "--workspace", o.Site, "--port", fmt.Sprint(o.Port)}
	if o.Frontend != "" {
		args = append(args, "--frontend", o.Frontend)
	}
	cmd := exec.Command(binary, args...)
	cmd.Env = append(os.Environ(), "WASMFYI_MANAGED_PREVIEW=1")
	cmd.Stdin = nil
	cmd.Stdout = log
	cmd.Stderr = log
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err = cmd.Start(); err != nil {
		return "", err
	}
	pid := cmd.Process.Pid
	ready := false
	defer func() {
		if !ready {
			_ = cmd.Process.Kill()
		}
	}()
	defer cmd.Process.Release()
	for i := 0; i < 100; i++ {
		if identity, ok := previewIdentity(o.Data); ok && identity.PID == pid {
			ready = true
			return identity.URL, nil
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
	return "", fmt.Errorf("preview did not become ready; see %s", filepath.Join(o.Data, "runtime", "preview.log"))
}
func localServe(ctx context.Context, o localOptions, assets string, background bool, args []string) error {
	if len(args) > 0 {
		if len(args) != 1 || args[0] != "stop" {
			return fmt.Errorf("use wasmfyi serve [stop]")
		}
		i, ok := previewIdentity(o.Data)
		if !ok {
			return fmt.Errorf("no CLI-owned preview is running for this dataset")
		}
		if err := syscall.Kill(i.PID, syscall.SIGTERM); err != nil {
			return err
		}
		fmt.Println("Stopped local preview.")
		return nil
	}
	if background {
		url, err := ensureLocalPreview(ctx, o)
		if err == nil {
			fmt.Println(url)
		}
		return err
	}
	if i, ok := previewIdentity(o.Data); ok {
		fmt.Println(i.URL)
		return nil
	}
	if err := os.MkdirAll(filepath.Join(o.Data, "runtime"), 0700); err != nil {
		return err
	}
	release, err := localNamedLease(filepath.Join(o.Data, "runtime", "preview.lock"))
	if err != nil {
		return fmt.Errorf("a preview is already starting for this dataset: %w", err)
	}
	defer release()
	if assets == "" {
		assets = filepath.Join(o.Site, "build")
	}
	if _, err := os.Stat(filepath.Join(assets, "404.html")); err != nil {
		return fmt.Errorf("frontend assets are missing; run pnpm build in %s or install the CLI distribution", o.Site)
	}
	db, err := localDB(ctx, o.Data)
	if err != nil {
		return err
	}
	defer db.Close()
	host, err := frontend.Open(assets, func(_ context.Context, w string) (bool, error) { return w != "", nil })
	if err != nil {
		return err
	}
	defer host.Close()
	host.UseShellOnly()
	secret := make([]byte, 32)
	if _, err = rand.Read(secret); err != nil {
		return err
	}
	handler, err := api.NewBenchmarks(db, hex.EncodeToString(secret), api.DefaultRequestLimits(), host)
	if err != nil {
		return err
	}
	// Publishing is private Go-to-SQL; the browser never receives an admin token.
	reads := api.ReadOnlyBenchmarks(handler)
	mux := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := r.Host
		if h, _, e := net.SplitHostPort(name); e == nil {
			name = h
		}
		ip := net.ParseIP(name)
		if name != "localhost" && (ip == nil || !ip.IsLoopback()) {
			http.Error(w, "local preview requires a loopback host", http.StatusForbidden)
			return
		}
		if r.URL.Path == "/api/local/runs" || strings.HasPrefix(r.URL.Path, "/api/local/runs/") {
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("X-Content-Type-Options", "nosniff")
			if r.Method != "GET" {
				w.WriteHeader(405)
				return
			}
			id := strings.TrimPrefix(r.URL.Path, "/api/local/runs/")
			if r.URL.Path == "/api/local/runs" {
				runs, err := db.LocalRuns(r.Context())
				if err != nil {
					http.Error(w, "run listing unavailable", 500)
					return
				}
				for i := range runs {
					runs[i].Plan = nil
				}
				_ = json.NewEncoder(w).Encode(runs)
				return
			}
			if !localIdentifier(id) {
				w.WriteHeader(404)
				return
			}
			run, err := db.LocalRun(r.Context(), id)
			if err != nil {
				w.WriteHeader(404)
				return
			}
			values, err := db.LocalValues(r.Context(), id)
			if err != nil {
				w.WriteHeader(500)
				return
			}
			// Plans contain private build paths. Return only the display/source fields.
			var p map[string]json.RawMessage
			_ = json.Unmarshal(run.Plan, &p)
			display := map[string]json.RawMessage{}
			for _, key := range []string{"host", "created", "mode", "collection"} {
				display[key] = p[key]
			}
			var engines []map[string]json.RawMessage
			_ = json.Unmarshal(p["engines"], &engines)
			public := []map[string]json.RawMessage{}
			for _, engine := range engines {
				e := map[string]json.RawMessage{}
				for _, key := range []string{"id", "engine", "repository", "ref"} {
					e[key] = engine[key]
				}
				var source map[string]json.RawMessage
				_ = json.Unmarshal(engine["source"], &source)
				s := map[string]json.RawMessage{}
				for _, key := range []string{"base", "digest", "revision", "local", "tag"} {
					if value, ok := source[key]; ok {
						s[key] = value
					}
				}
				e["source"], _ = json.Marshal(s)
				public = append(public, e)
			}
			display["engines"], _ = json.Marshal(public)
			run.Plan = nil
			_ = json.NewEncoder(w).Encode(map[string]any{"run": run, "plan": display, "items": values})
			return
		}
		reads.ServeHTTP(w, r)
	})
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", o.Port))
	if err != nil {
		return err
	}
	defer listener.Close()
	port := listener.Addr().(*net.TCPAddr).Port
	url := fmt.Sprintf("http://localhost:%d", port)
	identity := newLocalIdentity("")
	identity.URL = url
	identity.Data = o.Data
	if err = os.MkdirAll(filepath.Join(o.Data, "runtime"), 0700); err != nil {
		return err
	}
	identityPath := filepath.Join(o.Data, "runtime", "preview.json")
	b, _ := json.Marshal(identity)
	if err = os.WriteFile(identityPath, b, 0600); err != nil {
		return err
	}
	defer os.Remove(identityPath)
	fmt.Printf("Local results: %s\n", url)
	server := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	err = server.Serve(listener)
	if err == http.ErrServerClosed {
		return nil
	}
	return err
}
