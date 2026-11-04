package agent

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"github.com/wasmbench/wasmbench/protocol"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestStartupRetryHelper(t *testing.T) {
	if os.Getenv("WASMFYI_STARTUP_HELPER") != "1" {
		return
	}
	marker := os.Getenv("WASMFYI_STARTUP_MARKER")
	trace, _ := os.OpenFile(marker+".trace", os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	fmt.Fprintln(trace, "spawn", os.Getpid())
	trace.Close()
	_, err := os.Stat(marker)
	if os.Getenv("WASMFYI_STARTUP_MODE") == "silent" || os.IsNotExist(err) {
		os.WriteFile(marker, []byte(strconv.Itoa(os.Getpid())), 0600)
		time.Sleep(20 * time.Second)
		os.Exit(0)
	}
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		var request protocol.Request
		if json.Unmarshal(scanner.Bytes(), &request) != nil {
			os.Exit(2)
		}
		f, _ := os.OpenFile(marker+".trace", os.O_APPEND|os.O_WRONLY, 0600)
		fmt.Fprintln(f, request.Method)
		f.Close()
		response := protocol.Response{Version: 1, ID: request.ID, Status: "ok"}
		if request.Method == "describe" {
			response.Description = &protocol.Description{Runtime: "fixture", Version: "1", Backend: "fixture"}
		}
		if request.Method == "run" {
			response.Status = "error"
			response.Reason = "guest failure"
		}
		json.NewEncoder(os.Stdout).Encode(response)
	}
	os.Exit(0)
}
func startupFixture(t *testing.T, mode string) ([]string, string) {
	t.Helper()
	marker := filepath.Join(t.TempDir(), "marker")
	t.Setenv("WASMFYI_STARTUP_HELPER", "1")
	t.Setenv("WASMFYI_STARTUP_MARKER", marker)
	t.Setenv("WASMFYI_STARTUP_MODE", mode)
	return []string{os.Args[0], "-test.run=^TestStartupRetryHelper$"}, marker
}
func TestStartupRetryReapsAndPreservesActualPID(t *testing.T) {
	command, marker := startupFixture(t, "first-silent")
	client, err := startWithStartupRetries(context.Background(), command, marker+".log", 3*time.Second, ResourcePolicy{}, 3, 200*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	data, _ := os.ReadFile(marker)
	dead, _ := strconv.Atoi(string(data))
	if err := syscall.Kill(dead, 0); err != syscall.ESRCH {
		t.Fatalf("failed startup child %d still exists: %v", dead, err)
	}
	if client.PID() == dead {
		t.Fatal("measured PID is the failed child")
	}
	response, err := client.Call(protocol.Request{Method: "describe"})
	if err != nil || response.Description == nil {
		t.Fatalf("metadata replay: %+v %v", response, err)
	}
	if _, err = client.Call(protocol.Request{Method: "prepare"}); err != nil {
		t.Fatal(err)
	}
	response, err = client.Call(protocol.Request{Method: "run"})
	if err == nil || response.Status != "error" {
		t.Fatalf("guest failure changed: %+v %v", response, err)
	}
	trace, _ := os.ReadFile(marker + ".trace")
	var spawns, describes int
	for _, line := range splitStartupLines(string(trace)) {
		if len(line) > 5 && line[:5] == "spawn" {
			spawns++
		}
		if line == "describe" {
			describes++
		}
	}
	if spawns != 2 || describes != 1 {
		t.Fatalf("unexpected retries or extra metadata: %s", trace)
	}
}
func splitStartupLines(s string) []string { return strings.Split(strings.TrimSpace(s), "\n") }
func TestStartupRetriesAreBounded(t *testing.T) {
	command, marker := startupFixture(t, "silent")
	start := time.Now()
	client, err := startWithStartupRetries(context.Background(), command, marker+".log", 3*time.Second, ResourcePolicy{}, 2, 100*time.Millisecond)
	if err == nil || client != nil {
		t.Fatal("silent adapter succeeded")
	}
	if time.Since(start) > 2*time.Second {
		t.Fatal("retry budget exceeded")
	}
	trace, _ := os.ReadFile(marker + ".trace")
	spawns := 0
	for _, line := range splitStartupLines(string(trace)) {
		if len(line) > 5 && line[:5] == "spawn" {
			spawns++
		}
	}
	if spawns != 2 {
		t.Fatalf("unexpected attempt count: %s", trace)
	}
}
func TestStartupRetryHonorsParentCancellation(t *testing.T) {
	command, marker := startupFixture(t, "silent")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if c, err := startWithStartupRetries(ctx, command, marker+".log", time.Second, ResourcePolicy{}, 3, time.Second); err == nil || c != nil {
		t.Fatal("cancel ignored")
	}
	if _, err := os.Stat(marker + ".trace"); !os.IsNotExist(err) {
		t.Fatal("spawned child after cancellation")
	}
}
