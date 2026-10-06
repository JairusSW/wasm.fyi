package api

import (
	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"io"
	"net/http"
	"strconv"
)

func (a *API) archive(w http.ResponseWriter, r *http.Request, revision string, parts []string, n int, c cursor, immutable bool) {
	job, err := a.Store.PublishedArchive(r.Context(), revision, parts[1])
	if err != nil {
		problem(w, r, err)
		return
	}
	parent := job.ParentArchive
	if len(parts) == 2 {
		content := map[string]any{"status": "not_imported", "reason": "legacy job retains a parent index identity without stored archive content"}
		descriptor := map[string]any{"schema": 1, "revision": revision, "job": parts[1], "session": job.Session, "machine": job.Machine, "plan": job.Plan, "sourceIndexSha256": job.ParentBundleSHA256, "content": content, "qualification": "not_checked", "replayStatus": "conditional", "replayReason": "compatible OS and unlisted native libraries may still be required; archived code is never executed by this API"}
		if parent != nil {
			content = map[string]any{"status": "available", "sha256": parent.SHA256, "bytes": parent.Bytes, "mediaType": "application/gzip", "encoding": "original gzip archive"}
			descriptor["content"] = content
			descriptor["chunkCount"] = len(parent.Chunks)
			descriptor["metadataSha256"] = parent.Metadata.SHA256
			descriptor["integrity"] = "original-part-and-full-sha256-verified"
		}
		respond(w, r, 200, descriptor, immutable)
		return
	}
	if parent == nil {
		problem(w, r, store.ErrNotFound)
		return
	}
	if len(parts) == 3 && parts[2] == "download" {
		a.download(w, r, func() (downloadInfo, io.Reader, error) {
			p, reader, err := a.Store.OpenArchive(r.Context(), revision, parts[1])
			return downloadInfo{"bundle.tar.gz", "application/gzip", p.SHA256, p.Bytes}, reader, err
		})
		return
	}
	if len(parts) == 3 && (parts[2] == "metadata" || parts[2] == "index") {
		digest := parent.Metadata.SHA256
		if parts[2] == "index" {
			digest = parent.Index.SHA256
		}
		_, b, err := a.Store.ArchiveObject(r.Context(), revision, parts[1], digest)
		if err != nil {
			problem(w, r, err)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Content-Length", strconv.Itoa(len(b)))
		w.Header().Set("ETag", `"`+digest+`"`)
		if immutable {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		_, _ = w.Write(b)
		return
	}
	if len(parts) == 3 && parts[2] == "chunks" {
		query := "archive-chunks:" + parts[1] + ":" + strconv.Itoa(n)
		if c.Revision != "" && (c.Revision != revision || c.Query != query) {
			problem(w, r, wire.Invalid("cursor scope differs"))
			return
		}
		if c.Offset < 0 || c.Offset > len(parent.Chunks) {
			problem(w, r, wire.Invalid("invalid chunk offset"))
			return
		}
		end := min(c.Offset+n, len(parent.Chunks))
		next := ""
		if end < len(parent.Chunks) {
			next = a.sign(cursor{revision, query, end})
		}
		respond(w, r, 200, map[string]any{"revision": revision, "job": parts[1], "items": parent.Chunks[c.Offset:end], "total": len(parent.Chunks), "complete": end == len(parent.Chunks), "nextCursor": next}, immutable)
		return
	}
	if len(parts) == 4 && parts[2] == "chunks" {
		object, b, err := a.Store.ArchiveObject(r.Context(), revision, parts[1], parts[3])
		if err != nil {
			problem(w, r, err)
			return
		}
		if object.Kind != "binary" {
			problem(w, r, store.ErrNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Disposition", `attachment; filename="bundle.tar.gz.part"`)
		w.Header().Set("Content-Length", strconv.Itoa(len(b)))
		w.Header().Set("ETag", `"`+object.SHA256+`"`)
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		if r.Method != "HEAD" {
			_, _ = w.Write(b)
		}
		return
	}
	http.NotFound(w, r)
}
