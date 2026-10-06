package api

import (
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"net/http"
	"strconv"
	"strings"
)

func (a *API) revisions(w http.ResponseWriter, r *http.Request, revision string, n int, c cursor) {
	prefix := "revisions-v2:" + strconv.Itoa(n) + ":"
	next := ""
	if c.Revision != "" {
		if c.Revision != revision || !strings.HasPrefix(c.Query, prefix) {
			problem(w, r, wire.Invalid("revision cursor scope differs"))
			return
		}
		next = strings.TrimPrefix(c.Query, prefix)
		if !wire.IsHash(next) {
			problem(w, r, wire.Invalid("invalid revision successor"))
			return
		}
	}
	page, err := a.Store.RevisionPageContext(r.Context(), revision, next, c.Offset, n)
	if err != nil {
		problem(w, r, err)
		return
	}
	continuation := ""
	if page.Next != "" {
		continuation = a.sign(cursor{revision, prefix + page.Next, page.Offset})
	}
	respond(w, r, 200, map[string]any{"revision": revision, "items": page.Items, "total": page.Total, "complete": page.Next == "", "nextCursor": continuation}, false)
}
