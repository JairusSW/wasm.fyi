package analytics

import (
	"context"
	"fmt"
	"sort"
	"time"
)

func (s *Store) cached(key string, build func() (any, error)) (any, error) {
	s.cacheMu.Lock()
	defer s.cacheMu.Unlock()
	if c, ok := s.cache[key]; ok && time.Now().Before(c.until) {
		return c.value, nil
	}
	v, e := build()
	if e == nil {
		s.cache[key] = cacheEntry{time.Now().Add(20 * time.Second), v}
	}
	return v, e
}
func (s *Store) Totals(ctx context.Context) (AllTime, error) {
	v, e := s.cached("totals", func() (any, error) {
		var t AllTime
		err := s.read.QueryRowContext(ctx, "SELECT since,v,p,a0,a1,a2,adown,aup,down,up,c FROM totals WHERE id=1").Scan(&t.Since, &t.Visitors, &t.Pageviews, &t.APIByOrigin.Website, &t.APIByOrigin.Programmatic, &t.APIByOrigin.Bots, &t.APIDown, &t.APIUp, &t.TotalDown, &t.TotalUp, &t.Clients)
		t.APIRequests = t.APIByOrigin.Website + t.APIByOrigin.Programmatic + t.APIByOrigin.Bots
		return t, err
	})
	if e != nil {
		return AllTime{}, e
	}
	return v.(AllTime), nil
}
func (s *Store) Bandwidth(ctx context.Context, window string, now time.Time) (Bandwidth, error) {
	duration, step, g := int64(3600), int64(60), int64(60)
	switch window {
	case "1h":
	case "1d":
		duration, step, g = 86400, 900, 900
	case "1w":
		duration, step, g = 604800, 7200, 3600
	case "1m":
		duration, step, g = 2592000, 86400, 86400
	default:
		return Bandwidth{}, fmt.Errorf("invalid window")
	}
	v, e := s.cached("bw:"+window, func() (any, error) {
		end := now.Unix()/step*step + step
		start := end - duration
		b := Bandwidth{Window: window, Step: step * 1000, Series: []BwPoint{}}
		since := int64(0)
		if err := s.read.QueryRowContext(ctx, "SELECT since FROM totals WHERE id=1").Scan(&since); err != nil {
			return b, err
		}
		b.ComparisonAvailable = window != "1m" && since <= (start-duration)*1000
		points := map[int64]BwPoint{}
		rows, err := s.read.QueryContext(ctx, "SELECT (t / ?) * ?,SUM(down),SUM(up) FROM buckets WHERE g=? AND t>=? AND t<? GROUP BY 1 ORDER BY 1", step, step, g, start-duration, end)
		if err != nil {
			return b, err
		}
		defer rows.Close()
		for rows.Next() {
			var at, down, up int64
			if err = rows.Scan(&at, &down, &up); err != nil {
				return b, err
			}
			if at < start {
				b.PrevDown += down
				b.PrevUp += up
			} else {
				points[at] = BwPoint{at * 1000, down, up}
				b.Down += down
				b.Up += up
				rate := float64(down) / float64(step)
				if rate > b.PeakDown {
					b.PeakDown = rate
				}
			}
		}
		for at := start; at < end; at += step {
			p, ok := points[at]
			if !ok {
				p.At = at * 1000
			}
			b.Series = append(b.Series, p)
		}
		return b, rows.Err()
	})
	if e != nil {
		return Bandwidth{}, e
	}
	return v.(Bandwidth), nil
}

type fact struct {
	kind            int
	id              int64
	label, extra    string
	lat, lon        float64
	origin          int
	n, errors, last int64
	h               []byte
}

func (s *Store) facts(ctx context.Context, g, start, end int64) ([]fact, error) {
	rows, e := s.read.QueryContext(ctx, `SELECT d.kind,d.id,d.label,d.extra,d.lat,d.lon,f.o,f.n,f.e,f.last,f.h FROM facts f JOIN dimensions d ON d.id=f.d WHERE f.g=? AND f.t>=? AND f.t<?`, g, start, end)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	by := map[string]*fact{}
	for rows.Next() {
		var f fact
		if e = rows.Scan(&f.kind, &f.id, &f.label, &f.extra, &f.lat, &f.lon, &f.origin, &f.n, &f.errors, &f.last, &f.h); e != nil {
			return nil, e
		}
		key := fmt.Sprintf("%d:%d", f.id, f.origin)
		if old := by[key]; old != nil {
			old.n += f.n
			old.errors += f.errors
			if f.last > old.last {
				old.last = f.last
			}
			old.h = mergeHist(old.h, f.h)
		} else {
			by[key] = &f
		}
	}
	out := make([]fact, 0, len(by))
	for _, f := range by {
		out = append(out, *f)
	}
	return out, rows.Err()
}
func addCount(c *Counts, o int, n int64) {
	switch o {
	case 0:
		c.Website += n
	case 1:
		c.Programmatic += n
	case 2:
		c.Bots += n
	}
}
func (s *Store) Analytics(ctx context.Context, rangeName string, now time.Time) (Analytics, error) {
	duration, step, g := int64(86400), int64(3600), int64(3600)
	switch rangeName {
	case "24h":
	case "7d":
		duration, step, g = 604800, 21600, 3600
	case "30d":
		duration, step, g = 2592000, 86400, 86400
	default:
		return Analytics{}, fmt.Errorf("invalid range")
	}
	v, e := s.cached("analytics:"+rangeName, func() (any, error) {
		a := Analytics{Range: rangeName, Generated: now.UnixMilli(), KPIs: []KPI{}, Series: []Point{}, Clients: []Client{}, Endpoints: []Endpoint{}, Pages: []Page{}, Referrers: []Share{}, Countries: []Share{}, Devices: []Share{}, Browsers: []Share{}, Runtimes: []Share{}, Workloads: []Share{}, Log: []LogLine{}, Places: []Place{}}
		end := now.Unix()/step*step + step
		start := end - duration
		points := map[int64]Point{}
		bucketErrors := map[int64]int64{}
		var pv, prevPV, api, prevAPI, errorsN, prevErr int64
		rows, err := s.read.QueryContext(ctx, `SELECT (t / ?) * ?,0,SUM(p),SUM(a0),SUM(a1),SUM(a2),SUM(err) FROM buckets WHERE g=? AND t>=? AND t<? GROUP BY 1 ORDER BY 1`, step, step, g, start-duration, end)
		if err != nil {
			return a, err
		}
		for rows.Next() {
			var p Point
			var er int64
			if err = rows.Scan(&p.At, &p.Visitors, &p.Pageviews, &p.API.Website, &p.API.Programmatic, &p.API.Bots, &er); err != nil {
				rows.Close()
				return a, err
			}
			n := p.API.Website + p.API.Programmatic + p.API.Bots
			if p.At < start {
				prevPV += p.Pageviews
				prevAPI += n
				prevErr += er
			} else {
				pv += p.Pageviews
				api += n
				errorsN += er
				at := p.At
				p.At *= 1000
				points[at] = p
				bucketErrors[at] = er
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return a, err
		}
		// Visitor identities are sets, not additive counters: one daily identity
		// seen in multiple source buckets still counts once in a displayed bucket.
		visitorRows, err := s.read.QueryContext(ctx, `SELECT (t / ?) * ?,COUNT(DISTINCT id) FROM seen WHERE g=? AND t>=? AND t<? GROUP BY 1`, step, step, g, start, end)
		if err != nil {
			return a, err
		}
		for visitorRows.Next() {
			var at, n int64
			if err = visitorRows.Scan(&at, &n); err != nil {
				visitorRows.Close()
				return a, err
			}
			p := points[at]
			p.At = at * 1000
			p.Visitors = n
			points[at] = p
		}
		err = visitorRows.Err()
		visitorRows.Close()
		if err != nil {
			return a, err
		}
		for at := start; at < end; at += step {
			p, ok := points[at]
			if !ok {
				p.At = at * 1000
			}
			a.Series = append(a.Series, p)
		}
		fs, err := s.facts(ctx, g, start, end)
		if err != nil {
			return a, err
		}
		prevFs, err := s.facts(ctx, g, start-duration, start)
		if err != nil {
			return a, err
		}
		visitors := int64(0)
		prevV := int64(0)
		if err = s.read.QueryRowContext(ctx, "SELECT COUNT(DISTINCT id) FROM seen WHERE g=900 AND t>=? AND t<?", start, end).Scan(&visitors); err != nil {
			return a, err
		}
		if err = s.read.QueryRowContext(ctx, "SELECT COUNT(DISTINCT id) FROM seen WHERE g=900 AND t>=? AND t<?", start-duration, start).Scan(&prevV); err != nil {
			return a, err
		}
		clientN, prevClients := int64(0), int64(0)
		h := []byte{}
		prevH := []byte{}
		for _, f := range prevFs {
			if f.kind == dimClient && f.origin == 1 {
				prevClients++
			}
			if f.kind == dimPath {
				prevH = mergeHist(prevH, f.h)
			}
		}
		shares := map[int]map[string]int64{}
		endpoints := map[string]*Endpoint{}
		places := map[int64]*Place{}
		for _, f := range fs {
			switch f.kind {
			case dimClient:
				origin := "programmatic"
				if f.origin == 2 {
					origin = "bots"
				} else {
					clientN++
				}
				a.Clients = append(a.Clients, Client{f.label, f.label, origin, f.extra, f.n, f.errors, "—", f.last, []float64{}})
			case dimPath:
				ep := endpoints[f.label]
				if ep == nil {
					ep = &Endpoint{Path: f.label}
					endpoints[f.label] = ep
				}
				addCount(&ep.Requests, f.origin, f.n)
				ep.Errors += float64(f.errors)
				h = mergeHist(h, f.h)
			case dimPage:
				a.Pages = append(a.Pages, Page{f.label, f.n, 0})
			case dimPlace:
				p := places[f.id]
				if p == nil {
					p = &Place{City: f.label, Country: f.extra, Lat: f.lat, Lon: f.lon}
					places[f.id] = p
				}
				if f.origin == 3 {
					p.Visitors += f.n
				} else {
					p.API += f.n
				}
			default:
				if shares[f.kind] == nil {
					shares[f.kind] = map[string]int64{}
				}
				shares[f.kind][f.label] += f.n
			}
		}
		// Compact client×endpoint counters give genuine top endpoints without raw logs.
		clientIDs := map[string]string{}
		for _, f := range fs {
			if f.kind == dimClient {
				origin := "programmatic"
				if f.origin == 2 {
					origin = "bots"
				}
				clientIDs[fmt.Sprintf("%d:%d", f.id, f.origin)] = origin + "\x00" + f.label + "\x00" + f.extra
			}
		}
		topPaths := map[string]string{}
		pathRows, err := s.read.QueryContext(ctx, `SELECT c,o,p.label,SUM(n) FROM client_paths cp JOIN dimensions p ON p.id=cp.p WHERE cp.g=? AND cp.t>=? AND cp.t<? GROUP BY cp.c,cp.o,cp.p ORDER BY SUM(n) DESC`, g, start, end)
		if err != nil {
			return a, err
		}
		for pathRows.Next() {
			var c, n int64
			var o int
			var path string
			if err = pathRows.Scan(&c, &o, &path, &n); err != nil {
				pathRows.Close()
				return a, err
			}
			key := clientIDs[fmt.Sprintf("%d:%d", c, o)]
			if key != "" && topPaths[key] == "" {
				topPaths[key] = path
			}
		}
		err = pathRows.Err()
		pathRows.Close()
		if err != nil {
			return a, err
		}
		clientSparks := map[string][]float64{}
		latencySparks := map[int64][]byte{}
		distinctSparks := map[int64]map[int64]bool{}
		sparkRows, err := s.read.QueryContext(ctx, `SELECT d.kind,d.id,d.label,d.extra,f.o,f.t,f.n,f.h FROM facts f JOIN dimensions d ON d.id=f.d WHERE f.g=? AND f.t>=? AND f.t<? AND d.kind IN(1,2)`, g, start, end)
		if err != nil {
			return a, err
		}
		for sparkRows.Next() {
			var kind, o int
			var id, at, n int64
			var label, extra string
			var h []byte
			if err = sparkRows.Scan(&kind, &id, &label, &extra, &o, &at, &n, &h); err != nil {
				sparkRows.Close()
				return a, err
			}
			bucket := at / step * step
			if kind == dimPath {
				latencySparks[bucket] = mergeHist(latencySparks[bucket], h)
			} else {
				origin := "programmatic"
				if o == 2 {
					origin = "bots"
				}
				key := origin + "\x00" + label + "\x00" + extra
				if clientSparks[key] == nil {
					clientSparks[key] = make([]float64, len(a.Series))
				}
				i := (bucket - start) / step
				if i >= 0 && i < int64(len(a.Series)) {
					clientSparks[key][i] += float64(n)
				}
				if o == 1 {
					if distinctSparks[bucket] == nil {
						distinctSparks[bucket] = map[int64]bool{}
					}
					distinctSparks[bucket][id] = true
				}
			}
		}
		err = sparkRows.Err()
		sparkRows.Close()
		if err != nil {
			return a, err
		}
		for i := range a.Clients {
			key := a.Clients[i].Origin + "\x00" + a.Clients[i].Agent + "\x00" + a.Clients[i].Network
			a.Clients[i].Spark = clientSparks[key]
			if path := topPaths[key]; path != "" {
				a.Clients[i].TopEndpoint = path
			}
		}
		// Endpoint percentiles merge bucket histograms before calculating quantiles.
		for path, ep := range endpoints {
			eh := []byte{}
			for _, f := range fs {
				if f.kind == dimPath && f.label == path {
					eh = mergeHist(eh, f.h)
				}
			}
			ep.P50 = percentile(eh, .5)
			ep.P95 = percentile(eh, .95)
			n := ep.Requests.Website + ep.Requests.Programmatic + ep.Requests.Bots
			if n > 0 {
				ep.Errors = ep.Errors / float64(n) * 100
			}
			a.Endpoints = append(a.Endpoints, *ep)
		}
		for _, p := range places {
			a.Places = append(a.Places, *p)
		}
		sort.Slice(a.Places, func(i, j int) bool {
			return a.Places[i].Visitors+a.Places[i].API > a.Places[j].Visitors+a.Places[j].API
		})
		if len(a.Places) > 500 {
			a.Places = a.Places[:500]
		}
		shareList := func(kind int) []Share {
			out := []Share{}
			for label, n := range shares[kind] {
				out = append(out, Share{Label: label, Value: n})
			}
			sort.Slice(out, func(i, j int) bool { return out[i].Value > out[j].Value })
			if len(out) > 30 {
				out = out[:30]
			}
			return out
		}
		a.Referrers = shareList(dimRef)
		a.Countries = shareList(dimCountry)
		a.Devices = shareList(dimDevice)
		a.Browsers = shareList(dimBrowser)
		a.Runtimes = shareList(dimRuntime)
		a.Workloads = shareList(dimWorkload)
		sort.Slice(a.Clients, func(i, j int) bool { return a.Clients[i].Requests > a.Clients[j].Requests })
		if len(a.Clients) > 50 {
			a.Clients = a.Clients[:50]
		}
		sort.Slice(a.Endpoints, func(i, j int) bool {
			l, r := a.Endpoints[i].Requests, a.Endpoints[j].Requests
			return l.Website+l.Programmatic+l.Bots > r.Website+r.Programmatic+r.Bots
		})
		if len(a.Endpoints) > 50 {
			a.Endpoints = a.Endpoints[:50]
		}
		sort.Slice(a.Pages, func(i, j int) bool { return a.Pages[i].Value > a.Pages[j].Value })
		if len(a.Pages) > 30 {
			a.Pages = a.Pages[:30]
		}
		since := int64(0)
		if err = s.read.QueryRowContext(ctx, "SELECT since FROM totals WHERE id=1").Scan(&since); err != nil {
			return a, err
		}
		comparison := rangeName != "30d" && since <= (start-duration)*1000
		spark := func(metric string) []float64 {
			out := make([]float64, len(a.Series))
			for i, p := range a.Series {
				switch metric {
				case "visitors":
					out[i] = float64(p.Visitors)
				case "pageviews":
					out[i] = float64(p.Pageviews)
				case "api":
					out[i] = float64(p.API.Website + p.API.Programmatic + p.API.Bots)
				case "clients":
					out[i] = float64(len(distinctSparks[p.At/1000]))
				case "p95":
					out[i] = percentile(latencySparks[p.At/1000], .95)
				case "errors":
					n := p.API.Website + p.API.Programmatic + p.API.Bots
					if n > 0 {
						out[i] = float64(bucketErrors[p.At/1000]) / float64(n) * 100
					}
				}
			}
			return out
		}
		add := func(key, label string, value, prev float64, unit string, invert bool, hint string) {
			a.KPIs = append(a.KPIs, KPI{Key: key, Label: label, Value: value, Prev: prev, Unit: unit, Invert: invert, Spark: spark(key), Hint: hint, ComparisonAvailable: comparison})
		}
		add("visitors", "Unique views", float64(visitors), float64(prevV), "", false, "Daily unique visitors; identities rotate at UTC midnight and on server restart.")
		add("pageviews", "Views", float64(pv), float64(prevPV), "", false, "Page loads and client-side navigations; privacy opt-outs are respected.")
		add("session", "Avg. visit", 0, 0, "s", false, "Unavailable: duration tracking is not collected.")
		a.KPIs[len(a.KPIs)-1].Available = false
		add("bounce", "Bounce rate", 0, 0, "%", true, "Unavailable: no persistent visitor/session tracking.")
		a.KPIs[len(a.KPIs)-1].Available = false
		add("api", "API requests", float64(api), float64(prevAPI), "", false, "Public /api and /data requests, excluding analytics and authentication.")
		add("clients", "Programmatic clients", float64(clientN), float64(prevClients), "", false, "Distinct UA family and major version + ASN; unknown networks share one group.")
		add("p95", "API p95", percentile(h, .95), percentile(prevH, .95), "ms", true, "Upper bound from compact logarithmic server-latency histogram.")
		errorPct, prevPct := float64(0), float64(0)
		if api > 0 {
			errorPct = float64(errorsN) / float64(api) * 100
		}
		if prevAPI > 0 {
			prevPct = float64(prevErr) / float64(prevAPI) * 100
		}
		add("errors", "API errors", errorPct, prevPct, "%", true, "Share of public API responses that were 5xx.")
		for i := range a.KPIs {
			if a.KPIs[i].Key != "session" && a.KPIs[i].Key != "bounce" {
				a.KPIs[i].Available = true
			}
			if !comparison {
				a.KPIs[i].Hint += " Previous full period is unavailable within the retained 30-day window."
			}
		}
		logs, err := s.read.QueryContext(ctx, `SELECT e.at,e.status,e.method,p.label,e.origin,a.label,e.ms FROM events e JOIN dimensions p ON p.id=e.path JOIN dimensions a ON a.id=e.agent WHERE e.at>=? ORDER BY e.at DESC LIMIT 30`, start*1000)
		if err != nil {
			return a, err
		}
		for logs.Next() {
			var line LogLine
			var method, origin int
			if err = logs.Scan(&line.At, &line.Status, &method, &line.Path, &origin, &line.Agent, &line.MS); err != nil {
				logs.Close()
				return a, err
			}
			line.Method = []string{"OTHER", "GET", "POST", "HEAD", "PUT", "DELETE", "OPTIONS"}[method]
			line.Origin = []string{"website", "programmatic", "bots"}[origin]
			a.Log = append(a.Log, line)
		}
		err = logs.Err()
		logs.Close()
		return a, err
	})
	if e != nil {
		return Analytics{}, e
	}
	return v.(Analytics), nil
}
