# Metrics dashboard, exports and per-node information

## What exists now (HTC View, Simulator → Métricas)

- Sections: Visão geral, Atores e mensagens, Time Warp, Viagens e vias, Pessoas e transporte, Roteamento, Carga e relatórios,
  JVM e processo, Nós, Explorador (any metric: split by label, value or per-second rate; histograms: average + distribution).
  All 79 engine metrics (`hyperbolic-time-chamber/.../metrics`) plus JVM/process are used. Charts are own SVG (no chart library).
- Window (2/5/15 min/all), refresh interval, pause, clear history. History is kept in the browser (360 points per series).
- Export, Grafana-style: every panel has **Exportar** → PNG, JPEG (3x), SVG (vector, line charts), CSV (one column per series, like
  Grafana's "join by field", or long format), JSON (with source, window, timestamps, units). Toolbar: all collected series as CSV/JSON,
  and a **PDF report** (current section, or all sections; A4 landscape, 2 panels per row, JPEG images). Libraries added: `html-to-image`, `jspdf`.
  Limits: raster images use the page theme and the system sans font (the Google font stylesheet cannot be embedded); PDF pages are images,
  not vector; the CSV/JSON of a panel hold only what the browser collected during the session (use "Tudo" for the whole history).
- Source: the HTC View server reads `HTC_METRICS_URL` (default `http://localhost:9002/metrics`). It accepts several nodes:
  `HTC_METRICS_URL="pereiro=http://10.0.0.5:9002/metrics,sao-paulo=http://10.0.0.6:9002/metrics"`. Each target adds a `node` label
  (the name before `=`, else host:port), which the **Nós** section and the Explorador can group by. This already gives per-node
  views with names of your choice, without engine changes.

## Node identity inside the engine: implemented (see `hyperbolic-time-chamber/docs/NODE_IDENTITY.md`)

Each node gets a rank from the cluster membership and a label from a fixed list (`rank`, `animals`, `cities`; only the strategy is
chosen, `HTC_NODE_LABEL`). Messages carry the sender's rank (3 bytes), the receiver counts local vs remote per node pair
(`htc_messages_by_node_total{from_node,to_node,locality}`), `htc_node_info` publishes the node, and reports gain `node`/`from_node`
columns. The **Nós** section shows the nodes, the share of local/remote traffic, the origin x destination matrix (exportable as
CSV/JSON/PNG/PDF), traffic over time, the most frequent pairs, the message type (local x remote per `event_type`), the actor-class
matrix and where each singleton runs. The **Managers** section lists every manager (singleton or per node), messages/s, mean and p95
handling time, a per-manager detail (messages by type, slowest types, time distribution) and the load-balance migrations
(origin x destination matrix, durations, planned by reason). Not yet: a real multi-node run.

## Execution stopwatches

The **Cronômetros / Stopwatches** section separates simulation-loop wall time, time-manager
synchronization, initial loading, progressive preparation/windows, balancing/rebalancing, and
vehicle/walking route calculation. It shows cumulative values per engine process and node,
including active elapsed time before the first completed observation. The table exports raw
numeric seconds and counts through CSV/JSON/LaTeX and is included in section/full PDF reports.
Cumulative values cover process lifetime, independently of the history-window selector.

Configure all node endpoints to see distributed work. Overlapping operations must not be summed
as total runtime or CPU time. See the [engine timing contract](../../hyperbolic-time-chamber/docs/EXECUTION_TIMINGS.md)
for exact start/stop boundaries, Prometheus names and persisted `execution_timing_summary` events
(including the ClickHouse `execution_timings` table). Existing engine builds show an unavailable
message until they publish `htc_execution_*`.

## Stop and station details on the map

In both Live and Replay, clicking a bus stop, bus station or subway station marker opens
its details panel with the exported name, actor ID, type and coordinates. A blank name is
shown as unavailable. The panel uses the existing `stops.json` metadata and DeckGL picking;
it performs no additional requests or per-frame scans. Waiting-passenger counts, arrival
predictions and service lines are not supplied by this marker metadata.

### Live passenger details

The stop panel now joins station queue/boarding reports with bus/train load, unload and
movement reports from the existing run-filtered WebSocket. Each observed line shows its
last reported waiting count, observed arrivals/boardings in the retained event window,
last observed vehicle ID, onboard passengers, capacity and vehicle occupancy when reported.
Occupancy describes that vehicle, not a complete line fleet or station crowding ratio.
No additional polling, WebSocket connection or per-frame fleet scan is introduced.

The panel follows the selected playback tick and retains a 600-tick event history, keeping
older queue baselines for the last reported waiting value. It deduplicates repeated reports
and sorts late reports; queue/vehicle report ticks remain visible. Values before retained
history, missing fields, unreported lines and locations without telemetry remain unavailable.
A disconnected stream is marked explicitly. Counts are observed events within the displayed
window, not guaranteed whole-run totals: joining late or losing messages cannot recover old
events. Replay currently supplies static marker details without passenger history.

Updated engines report a bus stop's first arrival, empty-queue vehicle visits at bus stops
and subway stations, and bus/train capacity alongside passenger-load reports. Rebuild the
engine and View to enable the full detail set. Older engines can supply partial values.
