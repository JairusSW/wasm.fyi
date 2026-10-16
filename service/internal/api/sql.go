package api

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/JairusSW/wasm.fyi/service/internal/benchdb"
	"github.com/JairusSW/wasm.fyi/service/internal/sqldb"
)

type sqlBrowsing interface {
	HistoricalReport(context.Context, sqldb.HistoricalQuery, string, string, string) (sqldb.HistoricalReportResult, error)
	HistoricalSummary(context.Context, sqldb.HistoricalQuery) (sqldb.HistoricalSummaryResult, error)
	HistoricalComparison(context.Context, sqldb.HistoricalQuery, string, string) (sqldb.HistoricalComparisonResult, error)
	Aggregate(context.Context, sqldb.AggregateQuery) (sqldb.AggregateResult, error)
	Matrix(context.Context, sqldb.MatrixQuery) (sqldb.Matrix, error)
	History(context.Context, sqldb.MatrixQuery, string, string) (sqldb.Matrix, error)
	Overview(context.Context, string) (sqldb.Overview, error)
	Detail(context.Context, string, int64, ...string) (benchdb.Result, error)
}

func (a *benchmarkAPI) serveSQL(w http.ResponseWriter, r *http.Request) bool {
	switch r.URL.Path {
	case "/api/history/summary", "/api/history/comparison", "/api/history/report", "/api/table", "/api/matrix", "/api/timeline", "/api/overview", "/api/observation", "/api/aggregates":
	default:
		return false
	}
	db, ok := a.db.(sqlBrowsing)
	if !ok {
		benchmarkError(w, r, 404, "not_found", "endpoint requires SQL storage")
		return true
	}
	if !method(w, r, "GET") {
		return true
	}
	fields := "platform"
	switch r.URL.Path {
	case "/api/history/summary", "/api/history/comparison", "/api/history/report":
		fields += "|platforms|metric|engines|baseline|weighting|cohort|average|workload|from|to"
		if r.URL.Path != "/api/history/summary" {
			fields += "|fromDate|toDate"
		}
		if r.URL.Path == "/api/history/report" {
			fields += "|engine"
		}
	case "/api/aggregates":
		fields += "|metric|metrics|engines|baseline|weighting|cohort|average"
	case "/api/table":
		fields += "|workload|engine|corpus|limit|offset|revision|phases|delta"
	case "/api/matrix":
		fields += "|phase|workload|engine|corpus|limit|offset|revision"
	case "/api/timeline":
		fields += "|phase|workload|engine|corpus|limit|offset|revision|from|to"
	case "/api/observation":
		fields += "|id|asOf"
	}
	if !queryFields(w, r, fields) {
		return true
	}
	q := r.URL.Query()
	var value any
	var err error
	switch r.URL.Path {
	case "/api/history/summary", "/api/history/comparison", "/api/history/report":
		engines := []string{}
		if q.Get("engines") != "" {
			engines = strings.Split(q.Get("engines"), ",")
		}
		query := sqldb.HistoricalQuery{Platform: q.Get("platform"), Metric: q.Get("metric"), Engines: engines, Baseline: q.Get("baseline"), Weighting: q.Get("weighting"), Cohort: q.Get("cohort"), Average: q.Get("average"), Workload: q.Get("workload"), From: q.Get("from"), To: q.Get("to")}
		if q.Get("platforms") != "" {
			query.Platforms = strings.Split(q.Get("platforms"), ",")
		}
		if r.URL.Path == "/api/history/summary" {
			value, err = db.HistoricalSummary(r.Context(), query)
		} else if r.URL.Path == "/api/history/report" {
			value, err = db.HistoricalReport(r.Context(), query, q.Get("engine"), q.Get("fromDate"), q.Get("toDate"))
		} else {
			value, err = db.HistoricalComparison(r.Context(), query, q.Get("fromDate"), q.Get("toDate"))
		}
	case "/api/aggregates":
		engines := []string{}
		if q.Get("engines") != "" {
			engines = strings.Split(q.Get("engines"), ",")
		}
		metric, weighting, cohort, average := q.Get("metric"), q.Get("weighting"), q.Get("cohort"), q.Get("average")
		if metric == "" {
			metric = "steady"
		}
		if weighting == "" {
			weighting = "corpus"
		}
		if cohort == "" {
			cohort = "shared"
		}
		if average == "" {
			average = "geo"
		}
		query := sqldb.AggregateQuery{Platform: q.Get("platform"), Metric: metric, Engines: engines, Baseline: q.Get("baseline"), Weighting: weighting, Cohort: cohort, Average: average}
		if q.Get("metrics") == "" && average != "both" {
			value, err = db.Aggregate(r.Context(), query)
		} else {
			metrics := []string{metric}
			if q.Get("metrics") != "" {
				metrics = strings.Split(q.Get("metrics"), ",")
			}
			if q.Get("metrics") != "" && q.Get("metric") != "" || len(metrics) > 12 {
				benchmarkError(w, r, 400, "invalid_query", "use metric or up to twelve metrics")
				return true
			}
			type averagedAggregate struct {
				sqldb.AggregateResult
				Average string `json:"average"`
			}
			items := []averagedAggregate{}
			averages := []string{average}
			if average == "both" {
				averages = []string{"geo", "mean"}
			}
			rev := ""
			for _, variant := range averages {
				query.Average = variant
				for _, metric := range metrics {
					query.Metric = metric
					item, e := db.Aggregate(r.Context(), query)
					if e != nil {
						err = e
						break
					}
					if rev != "" && item.Revision != rev {
						err = benchdb.ErrChanged
						break
					}
					rev = item.Revision
					items = append(items, averagedAggregate{item, variant})
				}
				if err != nil {
					break
				}
			}
			value = struct {
				Revision string              `json:"revision"`
				Items    []averagedAggregate `json:"items"`
			}{rev, items}
		}
	case "/api/overview":
		value, err = db.Overview(r.Context(), q.Get("platform"))
	case "/api/observation":
		id, e := strconv.ParseInt(q.Get("id"), 10, 64)
		if e != nil || id < 1 {
			benchmarkError(w, r, 400, "invalid_query", "positive observation id required")
			return true
		}
		value, err = db.Detail(r.Context(), q.Get("platform"), id, q.Get("asOf"))
	default:
		maxLimit := 4096
		if r.URL.Path == "/api/table" {
			maxLimit = 16384
		}
		limit := maxLimit
		if q.Get("limit") != "" {
			limit, err = strconv.Atoi(q.Get("limit"))
			if err != nil || limit < 1 || limit > maxLimit {
				benchmarkError(w, r, 400, "invalid_query", "limit must be 1–"+strconv.Itoa(maxLimit))
				return true
			}
		}
		offset := 0
		if q.Get("offset") != "" {
			offset, err = strconv.Atoi(q.Get("offset"))
			if err != nil || offset < 0 {
				benchmarkError(w, r, 400, "invalid_query", "nonnegative offset required")
				return true
			}
		}
		if q.Get("delta") != "" && q.Get("delta") != "1" {
			benchmarkError(w, r, 400, "invalid_query", "delta must be 1")
			return true
		}
		query := sqldb.MatrixQuery{Phases: q.Get("phases"), Delta: q.Get("delta") == "1", Offset: offset, Revision: q.Get("revision"), Platform: q.Get("platform"), Phase: q.Get("phase"), Workload: q.Get("workload"), Engine: q.Get("engine"), Corpus: q.Get("corpus"), Limit: limit}
		if r.URL.Path == "/api/table" {
			table, ok := a.db.(interface {
				Table(context.Context, sqldb.MatrixQuery) (sqldb.Matrix, error)
			})
			if !ok {
				benchmarkError(w, r, 404, "not_found", "endpoint requires SQL storage")
				return true
			}
			value, err = table.Table(r.Context(), query)
		} else if r.URL.Path == "/api/timeline" {
			value, err = db.History(r.Context(), query, q.Get("from"), q.Get("to"))
		} else {
			value, err = db.Matrix(r.Context(), query)
		}
	}
	if matrix, ok := value.(sqldb.Matrix); ok {
		if r.URL.Path == "/api/table" {
			value = packTable(matrix)
		} else {
			value = packMatrix(matrix)
		}
	}
	if err != nil {
		benchmarkProblem(w, r, err)
	} else {
		respond(w, r, 200, value, false)
	}
	return true
}
