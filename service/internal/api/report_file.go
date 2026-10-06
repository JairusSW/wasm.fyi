package api

import (
	"context"
	"errors"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"io"
	"net/http"
	"strconv"
	"time"
)

func (a *API) reportFileDownload(w http.ResponseWriter, r *http.Request, revision, id string) {
	a.download(w, r, func() (downloadInfo, io.Reader, error) {
		file, reader, err := a.Store.OpenReportFile(r.Context(), revision, id)
		return downloadInfo{file.Name, file.MediaType, file.SHA256, file.Bytes}, reader, err
	})
}

type downloadInfo struct {
	Name, MediaType, SHA256 string
	Bytes                   int64
}

func (a *API) download(w http.ResponseWriter, r *http.Request, open func() (downloadInfo, io.Reader, error)) {
	if len(r.Header.Values("Range")) > 0 {
		problem(w, r, wire.Invalid("whole file download does not accept ranges"))
		return
	}
	release, ok := a.admitDownload(w, r)
	if !ok {
		return
	}
	defer release()
	file, reader, err := open()
	if err != nil {
		problem(w, r, err)
		return
	}
	w.Header().Set("Content-Type", file.MediaType)
	w.Header().Set("Content-Disposition", `attachment; filename="`+file.Name+`"`)
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.Header().Set("ETag", `"`+file.SHA256+`"`)
	if r.Header.Get("If-None-Match") == `"`+file.SHA256+`"` {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Length", strconv.FormatInt(file.Bytes, 10))
	if r.Method == "HEAD" {
		return
	}
	if _, err = io.CopyBuffer(w, reader, make([]byte, 32*1024)); err != nil {
		panic(http.ErrAbortHandler)
	}
}

func (a *API) admitDownload(w http.ResponseWriter, r *http.Request) (func(), bool) {
	select {
	case a.downloading <- struct{}{}:
	default:
		respond(w, r, 429, map[string]string{"error": "file download concurrency limit"}, false)
		return nil, false
	}
	controller := http.NewResponseController(w)
	if err := controller.SetWriteDeadline(time.Now().Add(5 * time.Minute)); err != nil && !errors.Is(err, http.ErrNotSupported) {
		<-a.downloading
		problem(w, r, err)
		return nil, false
	}
	stop := context.AfterFunc(r.Context(), func() { _ = controller.SetWriteDeadline(time.Now()) })
	return func() { stop(); <-a.downloading }, true
}
