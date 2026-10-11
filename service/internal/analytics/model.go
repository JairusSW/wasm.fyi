// Package analytics owns a separate, compact SQLite database. Request handlers
// enqueue bounded sanitized events; only the writer goroutine performs writes.
package analytics

import "time"

type Counts struct {
	Website      int64 `json:"website"`
	Programmatic int64 `json:"programmatic"`
	Bots         int64 `json:"bots"`
}
type Share struct {
	Label  string `json:"label"`
	Value  int64  `json:"value"`
	Detail string `json:"detail,omitempty"`
}
type Point struct {
	At        int64  `json:"at"`
	Visitors  int64  `json:"visitors"`
	Pageviews int64  `json:"pageviews"`
	API       Counts `json:"api"`
}
type KPI struct {
	ComparisonAvailable bool      `json:"comparisonAvailable"`
	Available           bool      `json:"available"`
	Key                 string    `json:"key"`
	Label               string    `json:"label"`
	Value               float64   `json:"value"`
	Prev                float64   `json:"prev"`
	Unit                string    `json:"unit,omitempty"`
	Invert              bool      `json:"invert,omitempty"`
	Spark               []float64 `json:"spark"`
	Hint                string    `json:"hint"`
}
type Client struct {
	Name        string    `json:"name"`
	Agent       string    `json:"agent"`
	Origin      string    `json:"origin"`
	Network     string    `json:"network"`
	Requests    int64     `json:"requests"`
	Errors      int64     `json:"errors"`
	TopEndpoint string    `json:"topEndpoint"`
	LastSeen    int64     `json:"lastSeen"`
	Spark       []float64 `json:"spark"`
}
type Endpoint struct {
	Path     string  `json:"path"`
	Requests Counts  `json:"requests"`
	P50      float64 `json:"p50"`
	P95      float64 `json:"p95"`
	Errors   float64 `json:"errors"`
}
type LogLine struct {
	At     int64   `json:"at"`
	Status int     `json:"status"`
	Method string  `json:"method"`
	Path   string  `json:"path"`
	Origin string  `json:"origin"`
	Agent  string  `json:"agent"`
	MS     float64 `json:"ms"`
}
type Page struct {
	Label   string  `json:"label"`
	Value   int64   `json:"value"`
	AvgTime float64 `json:"avgTime"`
}
type Place struct {
	City     string  `json:"city"`
	Country  string  `json:"country"`
	Lat      float64 `json:"lat"`
	Lon      float64 `json:"lon"`
	Visitors int64   `json:"visitors"`
	API      int64   `json:"api"`
}
type Analytics struct {
	Range     string     `json:"range"`
	Generated int64      `json:"generated"`
	KPIs      []KPI      `json:"kpis"`
	Series    []Point    `json:"series"`
	Clients   []Client   `json:"clients"`
	Endpoints []Endpoint `json:"endpoints"`
	Pages     []Page     `json:"pages"`
	Referrers []Share    `json:"referrers"`
	Countries []Share    `json:"countries"`
	Devices   []Share    `json:"devices"`
	Browsers  []Share    `json:"browsers"`
	Runtimes  []Share    `json:"runtimes"`
	Workloads []Share    `json:"workloads"`
	Log       []LogLine  `json:"log"`
	Places    []Place    `json:"places"`
}
type BwPoint struct {
	At   int64 `json:"at"`
	Down int64 `json:"down"`
	Up   int64 `json:"up"`
}
type Bandwidth struct {
	ComparisonAvailable bool      `json:"comparisonAvailable"`
	Window              string    `json:"window"`
	Step                int64     `json:"step"`
	Series              []BwPoint `json:"series"`
	Down                int64     `json:"down"`
	Up                  int64     `json:"up"`
	PrevDown            int64     `json:"prevDown"`
	PrevUp              int64     `json:"prevUp"`
	PeakDown            float64   `json:"peakDown"`
}
type AllTime struct {
	Since       int64  `json:"since"`
	Visitors    int64  `json:"visitors"`
	Pageviews   int64  `json:"pageviews"`
	APIRequests int64  `json:"apiRequests"`
	APIByOrigin Counts `json:"apiByOrigin"`
	APIDown     int64  `json:"apiDown"`
	APIUp       int64  `json:"apiUp"`
	TotalDown   int64  `json:"totalDown"`
	TotalUp     int64  `json:"totalUp"`
	Clients     int64  `json:"clients"`
}
type LiveRate struct {
	At   int64 `json:"at"`
	Down int64 `json:"down"`
	Up   int64 `json:"up"`
}
type Live struct {
	Rate LiveRate `json:"rate"`
}

// Event contains no IP, cookies, full UA or URL query. ID is a daily keyed digest.
// IP/UA reach only the short-lived queue input and are discarded before storage.
type Event struct {
	At                                                                         time.Time
	ID                                                                         []byte
	Origin                                                                     int
	API, APIBytes, Pageview                                                    bool
	Status                                                                     int
	Method, Path, Agent, Browser, Device, Network, Referrer, Runtime, Workload string
	City, Country                                                              string
	Lat, Lon                                                                   float64
	Geo                                                                        bool
	Down, Up                                                                   int64
	MS                                                                         float64
}
type Input struct {
	Event  Event
	IP, UA string
}
