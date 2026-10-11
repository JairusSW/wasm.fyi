<script lang="ts">
 import { base } from '$app/paths';
 const example = `curl 'https://wasm.fyi/api/platforms'
# Copy a returned items[].id into PLATFORM_ID:
curl --get 'https://wasm.fyi/api/benchmarks' \\
  --data-urlencode 'platform=PLATFORM_ID' \\
  --data-urlencode 'phase=steady' --data-urlencode 'limit=20'
# Continue with the returned opaque nextCursor (stop when null):
curl --get 'https://wasm.fyi/api/benchmarks' \\
  --data-urlencode 'cursor=NEXT_CURSOR' --data-urlencode 'limit=20'`;
</script>

<svelte:head><title>API and measurement guide · wasm.fyi</title></svelte:head>

<article class="guide">
 <header>
  <span class="eyebrow">Public data access</span>
  <h1>Read the measurements. Keep the context.</h1>
  <p class="lead">Use wasm.fyi from a browser, script or language model. Public API reads need no JavaScript, account or API key.</p>
 </header>
 <nav aria-label="Data documentation">
  <a href={base + '/schemas/api-v1.openapi.json'}>OpenAPI contract</a>
  <a href={base + '/data/llm/index.json'}>Discovery JSON</a>
  <a href={base + '/reference.md'}>Full HTTP reference</a>
  <a href={base + '/llms.txt'}>LLM reference</a>
 </nav>
 <section>
  <h2>Start with a measured platform</h2>
  <p><a href="/api/platforms">GET /api/platforms</a> lists actual hardware identifiers. Choose an item’s id, then request a small page from /api/benchmarks. <a href="/api/summary">GET /api/summary</a> gives compact counts, machine specifications and freshness.</p>
  <pre><code>{example}</code></pre>
  <p>The example placeholders must be replaced with values returned by the API. An empty platform list means no measurements are available in that database. It does not establish runtime support.</p>
 </section>
 <section>
  <h2>Choose the smallest useful response</h2>
  <ul>
   <li><strong>/api/benchmarks</strong>: current records for one platform and phase, with opaque cursor pagination.</li>
   <li><strong>/api/history</strong>: source-pinned historical records. Source target time and measurement time are different.</li>
   <li><strong>/api/matrix</strong> and <strong>/api/timeline</strong>: compact scalar rows with shared metadata dictionaries. Consult the contract before decoding array positions.</li>
   <li><strong>/api/observation</strong>: full ordered timing samples for a selected observation ID and platform. Forward source.asOf when selecting an exact historical alias.</li>
   <li><strong>/api/overview</strong> and <strong>/api/aggregates</strong>: explicitly scoped summaries. Record the cohort, weighting, baseline and averaging policy when citing them.</li>
   <li><strong>/api/history/summary</strong>, <strong>/api/history/comparison</strong> and <strong>/api/history/report</strong>: historical graphs and matched-cohort changes without downloading every sample.</li>
  </ul>
  <p>Reads are public. Publishing captures is administrator-only and is unnecessary for exploring or citing data.</p>
 </section>
 <section>
  <h2>Paginate consistently and cache politely</h2>
  <p>Record pages default to 200 results and accept a limit from 1 to 1000. Follow nextCursor unchanged and URL-encoded until null. Compact pages accept up to 4096 rows; follow nextOffset together with the returned revision and the same filters until null.</p>
  <p>A 409 revision_changed means the selected data changed: restart from the first page rather than mixing revisions. The platform catalog revision is global; result revisions are scoped. They are not interchangeable.</p>
  <p>Retain each URL’s ETag and send it as If-None-Match. A 304 has no JSON body. Respect Retry-After on 429. Errors use an error object with code and message; do not interpret an error or an empty page as zero performance.</p>
 </section>
 <section>
  <h2>Units and missing values</h2>
  <dl>
   <dt>latencyNs</dt><dd>Median nanoseconds per operation. The website may display converted units.</dd>
   <dt>peakRssBytes</dt><dd>Kernel-accounted process peak RSS in bytes. This is not heap allocation or memory attributable only to a phase.</dd>
   <dt>codeBytes</dt><dd>Native image or engine-reported code size in bytes. Inspect codeKind; different definitions are not equivalent.</dd>
  </dl>
  <p>Only an ok status carries a numeric value. Failed, unsupported, disabled and not-measured have null values. An observed zero remains zero; missing is never zero. Latency, memory and code have independent statuses.</p>
 </section>
 <section>
  <h2>Make fair, reproducible comparisons</h2>
  <p>Keep platform, artifactSha256, contractSha256, phase, runtime version/backend and sampling policy aligned. Retain the full API query, returned revision, source revision and capturedAt with your citation. A landing-page canonical URL does not identify a filtered comparison.</p>
  <p>Current results select the latest qualified source snapshot per engine. Missing results remain missing. History source.asOf is the source target date; capturedAt is when the measurement ran. An older source may have been measured recently.</p>
  <p>Adaptive samples characterize repeatability within a persistent process, not confidence across independent process launches. Read sampling and the ordered samplesNs in observation detail. Feature probes establish their exact contracts, not complete specification conformance or browser release support.</p>
  <p>The active service retains measurements, source metadata and timing samples. It does not retain execution evidence, archived run reports or Wasm binaries. There is no universal fastest-runtime conclusion from incomplete or unmatched coverage.</p>
 </section>
 <section>
  <h2>Stable documentation, live measurements</h2>
  <p>This page, the LLM references and the discovery manifest are deterministic documentation built from the repository. They contain no copied measurement dataset or fabricated freshness timestamp. Check the live API for data revisions and collection times.</p>
  <p>The retired /api/v1 routes and static benchmark shards have no compatibility aliases. Use the <a href={base + '/schemas/api-v1.openapi.json'}>current contract</a> and <a href="https://github.com/JairusSW/wasm.fyi/blob/main/API.md">versioned source reference</a>.</p>
 </section>
</article>

<style>
 .guide { max-width:860px;line-height:1.65;display:flex;flex-direction:column;gap:28px; }
 header h1 { font-size:clamp(26px,4vw,40px);line-height:1.15;letter-spacing:-.025em;margin:12px 0; }
 .lead { font-size:18px;color:var(--fg2); }
 nav { display:flex;flex-wrap:wrap;gap:12px 24px;border-block:1px solid var(--line);padding:16px 0; }
 h2 { font-size:20px;margin:0 0 12px; }
 p { margin:10px 0;color:var(--fg2); }
 a { color:var(--fg);text-underline-offset:3px; }
 li { margin:8px 0;color:var(--fg2); }
 pre { white-space:pre;overflow-x:auto;padding:18px;border:1px solid var(--line2);border-radius:8px;font-size:12px; }
 dt { font-family:var(--mono);font-weight:600;margin-top:12px; }
 dd { margin:4px 0;color:var(--fg2); }
</style>
