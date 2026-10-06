package api

import (
	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"net/http"
)

type overviewResponse = store.OverviewResponse

func projectOverview(c *store.Cohort, token string) overviewResponse {
	return store.ProjectOverview(c, token)
}
func (a *API) overview(w http.ResponseWriter, r *http.Request, c *store.Cohort, token string, immutable bool) {
	response, e := a.Store.BuildOverview(c)
	if e != nil {
		problem(w, r, e)
		return
	}
	response.Cohort = token
	respond(w, r, 200, response, immutable)
}
