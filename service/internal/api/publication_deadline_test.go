package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type publicationDeadlineRecorder struct {
	*httptest.ResponseRecorder
	deadlines []time.Time
}

func (w *publicationDeadlineRecorder) SetWriteDeadline(deadline time.Time) error {
	w.deadlines = append(w.deadlines, deadline)
	return nil
}
func TestPublicationDeadlineIsRestrictedToCommitRoutes(t *testing.T) {
	id := strings.Repeat("a", 64)
	for _, test := range []struct {
		method, path string
		expected     time.Duration
	}{
		{"POST", "/admin/v1/imports/" + id + "/commit", 5 * time.Minute},
		{"POST", "/admin/v1/plans/" + id + "/commit", 5 * time.Minute},
		{"GET", "/admin/v1/imports/" + id + "/commit", 15 * time.Second},
		{"POST", "/admin/v1/imports/not-a-hash/commit", 15 * time.Second},
		{"POST", "/admin/v1/progress", 15 * time.Second},
		{"PUT", "/admin/v1/objects/" + id, 15 * time.Second},
		{"GET", "/api/v1/results", 15 * time.Second},
	} {
		request := httptest.NewRequest(test.method, test.path, nil)
		if got := requestTimeout(request); got != test.expected {
			t.Fatal(test.path, got, test.expected)
		}
	}
}
func TestOnlyAuthenticatedCommitExtendsTransportWriteDeadline(t *testing.T) {
	a, h := telemetryAPI(t, nil)
	for _, resource := range []string{"imports", "plans"} {
		path := "/admin/v1/" + resource + "/" + strings.Repeat("a", 64) + "/commit"
		for _, authenticated := range []bool{false, true} {
			recorder := &publicationDeadlineRecorder{ResponseRecorder: httptest.NewRecorder()}
			r := httptest.NewRequest("POST", path, nil)
			if authenticated {
				r.Header.Set("Authorization", "Bearer "+a.Token)
			}
			before := time.Now()
			h.ServeHTTP(recorder, r)
			if !authenticated {
				if recorder.Code != http.StatusUnauthorized || len(recorder.deadlines) != 0 {
					t.Fatal("unauthenticated request extended writer", recorder.Code)
				}
			} else {
				// The unknown import returns a bounded error after admission, while still
				// exercising the same writer override as an actual large commit.
				if len(recorder.deadlines) != 1 || recorder.deadlines[0].Before(before.Add(299*time.Second)) || recorder.deadlines[0].After(time.Now().Add(301*time.Second)) {
					t.Fatal("commit did not override ordinary server write deadline", recorder.deadlines)
				}
			}
		}
	}
}

type deadlineEventRecorder struct {
	*httptest.ResponseRecorder
	events chan time.Time
}

func (w *deadlineEventRecorder) SetWriteDeadline(value time.Time) error {
	w.events <- value
	return nil
}
func TestPublicationCancellationStopsTransportWrite(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	w := &deadlineEventRecorder{ResponseRecorder: httptest.NewRecorder(), events: make(chan time.Time, 2)}
	stop, e := publicationWriteDeadline(w, httptest.NewRequest("POST", "/admin/v1/imports/"+strings.Repeat("a", 64)+"/commit", nil).WithContext(ctx))
	if e != nil {
		t.Fatal(e)
	}
	defer stop()
	future := <-w.events
	if future.Before(time.Now().Add(299 * time.Second)) {
		t.Fatal("publication writer was not bounded")
	}
	cancel()
	select {
	case deadline := <-w.events:
		if deadline.After(time.Now()) {
			t.Fatal("cancellation left writer blocked")
		}
	case <-time.After(time.Second):
		t.Fatal("cancellation did not reach writer")
	}
}
