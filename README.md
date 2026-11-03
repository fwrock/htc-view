# shadcn/ui monorepo template

This is a Next.js monorepo template with shadcn/ui.

## Como Executar

**Pré-requisitos:** Node.js >= 20

1. Instale as dependências:

```bash
npm install
```

2. Inicie o servidor de desenvolvimento:

```bash
npm run dev
```

A aplicação estará disponível em [http://localhost:3000](http://localhost:3000).

### Outros comandos

| Comando | Descrição |
|---|---|
| `npm run build` | Compila todos os pacotes/apps |
| `npm run lint` | Executa o linter |
| `npm run typecheck` | Verifica os tipos TypeScript |

## Docker volume example: Toulouse

On **Locations → Add location**, the **Docker Compose: Toulouse** shortcut fills the form
for the platform stack after verifying that `tl_1pct_meso` exists in the API's current mount.
If it is missing, the shortcut reports the required `.env` change instead of filling the form.
Expand **Example: tl_1pct_meso in Docker Compose** for the commands.

In the platform root `.env`, set:

```dotenv
HTC_SCENARIOS_HOST_DIR=/home/dean/hyperbolic-time-chamber/simulations/input
HTC_ENGINE_JAVA_OPTS=-Xms2g -Xmx24g
```

Then run `docker compose up -d` from the platform root. Compose mounts this directory into
the engine, SimEDaPE API and UI at `/scenarios`, and at
`/app/hyperbolic-time-chamber/simulations/input` for existing scenario files with absolute paths.

| UI field | Value |
|---|---|
| Type | Docker volume |
| Identifier | `toulouse` |
| Path accessible to the API | `/scenarios` |
| Path in the container | `/scenarios` |
| Use | Input |

Click **Add**, then **Test and list**. In **Simulator**, select `tl_1pct_meso` from
**Toulouse (Docker Compose)** and click **Start**. The scenario on the host is
`/home/dean/hyperbolic-time-chamber/simulations/input/tl_1pct_meso/simulation.json`.

Adding a location registers an existing mount; it does not create a Docker volume.
When the API runs directly on the host, its accessible path is the host directory instead.

The Toulouse example retains the full road network despite sampling 1% of the population,
so it needs more heap than the small-scenario default. Initial loading and routing-index warm-up
keep the tick at zero until startup finishes. The platform Compose uses static routing and four
time-manager workers on its single engine JVM; dynamic routing requires scenario RoutingService
actors and the `accounted` strategy.

### Toulouse live map and replay

While the engine is running, open
<http://localhost:3000/simulator/live?scenario=tl_1pct_meso&background=osm>.
The live map lists mounted scenarios as well as bundled demos, prepares static geometry when
needed, and subscribes only to events for the selected simulation. The timeline can pause,
scrub and play buffered live events; it does not pause the engine.

**Map background → OpenStreetMap** enables OSM tiles in both the live and replay panels.
The converted Toulouse scenario uses WGS84 coordinates from the MATSim files in
`tools/toulouse/input`; it does not require importing those source XML files into the UI again.
The background is independent of network provenance: this remains a MATSim-derived simulation
network, without OSM way IDs unless a `road_network.json` source is supplied.

After the run finishes, use
<http://localhost:3000/simulator/replay?scenario=tl_1pct_meso&background=osm> and generate the
replay from completed Parquet reports. Live geometry is stored separately under
`replay_out/.live-geometry/` and does not read active report files or overwrite completed replay
artifacts. `HTC_LIVE_GEOMETRY_JAVA_OPTS` controls its ETL heap (default `-Xmx2g`).

## Interface languages

HTC View supports Brazilian Portuguese (`pt`, the default), English (`en`), French
(`fr`) and Spanish (`es`). Select the language at the bottom of the sidebar. The
choice applies immediately, preserves the current page and form state, and is
remembered in the `htc.locale` cookie for one year. A fresh browser defaults to `pt`.
The public language identifier is always `pt`; number and date formatting uses
`pt-BR` for that language.

Translations live in `apps/web/lib/i18n/messages/{pt,en,fr,es}.json`. Components use
`useI18n()` for display text and locale-aware formatting. Keep interpolation tokens
such as `{0}` identical in every catalog. Configuration keys, scenario files,
user-entered names and API payloads retain their original values. Run
`npm run test:i18n --workspace web` to check catalog parity and interpolation.

## Native HTC runs in HTC View

`/simedape` currently hosts full HTC run controls using the management API implemented in
the `simedape` repository. This full-run path does not apply the SimEDaPE acceleration technique.
It can start supported full HTC scenarios, track job
progress, display measured link series with physical units and missing-value masks, and
download committed reports and datasets. New completed runs with geographic coordinates
also offer **Abrir replay deste run**; generate the replay once, then play/scrub its timeline.
The bridge fetches hash-verified inputs belonging to that run over HTTP and uses the existing
Scala replay ETL. Configure `NEXT_PUBLIC_SIMEDAPE_API_URL` on View
and the `SIMEDAPE_HTC_*` paths on the API server. Set `SIMEDAPE_API_URL` when Next.js needs
a different server-reachable API origin, plus `HTC_REPLAY_OUT_DIR` and `HTC_REPLAY_ETL_DIR`
for replay. The demo launcher sets these automatically. The original CSV/ClickHouse pipeline form
remains available on the same page.

From the platform root, launch a bounded car-only demo and both servers:

```bash
SIMEDAPE_PYTHON=/path/to/venv/bin/python scripts/run-native-integration-demo.sh
```

See the [runbook and verification](../simedape/docs/NATIVE_VIEW_INTEGRATION.md) for setup,
support limits and the remaining replay/live integration work.

## Maps and scenario editor proposal

Live and replay share an independent background by default. Set
`NEXT_PUBLIC_HTC_MAP_BACKGROUND=osm` for an OSM background with visible attribution.
This background switch does not validate correspondence between HTC links and OSM streets.
The [two-mode map contract](docs/SIMULATION_MAP_MODES.md) defines required standalone and
OSM-backed behavior and records the remaining geometry, road-following and picking work.
Set `NEXT_PUBLIC_HTC_MAP_STYLE_URL` for another style, or configure the tile URL and attribution
through `.env.local.example`. See [Real-time execution and maps](docs/REAL_TIME_AND_MAPS.md)
for current live/playback capabilities and the remaining pacing work.

Managed full **MICRO, MESO and mixed** runs now support optional live viewing from
`/simulator/runs`, with run-bound geometry, stream isolation and viewer readiness before
HTC starts. See [managed live setup and evidence](docs/MANAGED_LIVE_RUNS.md).

The [bounded OSM import workflow](docs/OSM_IMPORT_WORKFLOW.md) is implemented at
`/simulator/import` (linked from Execuções). Select a registered XML/gzip source and area,
review roads/diagnostics, publish a new revision, then execute HTC and open its replay.
Its API/client, real HTC runs and both map modes have scripted validation; fresh browser
acceptance remains pending. The review stack runs separately on :3001/:5003.

The [scenario entities editor](docs/SCENARIO_ENTITIES_EDITOR.md) is implemented under
**Modificações → Entidades e mapa**: topology, MICRO/MESO roads, signals, bus/metro stations,
stops/lines, demand, saved drafts, undo/redo, validation and immutable revision publication.
OSM-backed editing preserves source geometry; free topology editing uses explicit detachment.
Real multimodal engine checks passed; browser acceptance remains pending. The
[map editor specification](docs/MAP_EDITOR_SPEC.md) also records broader proposed GIS features.

## Live simulation visualization

`/simulator/live` (linked from a "Ver visualização ao vivo" button on `/simulator` while a
simulation is `Running`) renders vehicles moving in real time on a map, ported from the
standalone `htc-replay/web` prototype (deck.gl + maplibre-gl + apache-arrow + zustand, all
client-only map loading is delegated through `live-entry.tsx` with SSR disabled).
The route selects the managed viewer for `?run=<id>` and the general engine viewer
for the legacy scenario flow described below.

It connects to `htc-bus-live`'s WebSocket (`GET /ws/live`), which bridges Kafka topics
`dev.htc.simulation.{vehicle,link,person}-states.v1` and `dev.htc.simulation.metrics.v1`
(MICRO updates) — populated by the engine's `kafka` report
strategy (`htc.report-manager.enabled-strategies`, enabled by default) — into the flat JSON
envelope the frontend consumes. Configure the URL via `NEXT_PUBLIC_HTC_LIVE_WS_URL` (see
`.env.local.example`, default `ws://localhost:8090/ws/live`).

Live events don't carry road/intersection geometry — only positions — so the viewer pairs the
live feed with the same static geometry (`links.arrow`/`nodes.arrow`/etc.) the file-replay
prototype used, bundled at `apps/web/public/data/<scenario>/`. The scenario id is now passed
through from `/simulator`'s **Cenários** panel via `?scenario=<name>` on the
"Ver visualização ao vivo" button (falling back to `htc_hybrid_demo`, or any id listed in
`apps/web/public/data/scenarios.json`, when opened directly).

The live feed itself arrives at the engine's execution rate, which is far too fast to watch for
small scenarios. The viewer therefore decouples **visualization time** from arrival time with a
playback clock (`components/live/timeline/`): by default it follows the live edge
(`followLive`), and a bottom bar lets a human pause, scrub, slow down or fast-forward the
already-captured live window (speed is expressed in simulated-seconds per real second, `1x` =
real time). The clock is capped at the highest tick seen so far, so you can catch up to the
edge but never run ahead of data that hasn't arrived yet.

To run the whole chain locally in one shot, see `scripts/run-live-demo.sh` at the platform root.
The full runbook (manual steps, ports, env vars, replay bridge) lives in
[docs/RUNNING.md](docs/RUNNING.md).

## Replay bridge (serving scenario files + Parquet)

Scenario geometry and full-run replay both need files that live on the engine host's filesystem
(`HTC_SCENARIOS_DIR/<name>/data/` and `HTC_REPORT_PARQUET_DIRECTORY/<name>/*.parquet`), which the
browser cannot reach directly. The `/api/replay/*` route handlers (`apps/web/app/api/replay/`)
bridge that gap in local/dev deployments where the Next.js server shares the host with the engine:

- `GET /api/replay` — lists scenarios and, for each, what the bridge can locate (geometry `data/`,
  Parquet outputs, already-generated artifacts) plus the resolved paths.
- `GET /api/replay/<scenario>` — status: `not_generated` | `generating` | `ready` | `error`.
- `POST /api/replay/<scenario>` — runs the htc-replay ETL (`sbt run`) to derive `segments.arrow` +
  geometry artifacts from the Parquet outputs, asynchronously (poll the status endpoint).
- `GET /api/replay/<scenario>/<file>` — serves one artifact (generated output first, then the
  bundled copy under `public/data/`).

Paths are env-configurable with machine-local defaults (see `lib/replay-config.ts`):
`HTC_SCENARIOS_DIR`, `HTC_REPORT_PARQUET_DIRECTORY`, `HTC_REPLAY_OUT_DIR`, `HTC_REPLAY_ETL_DIR`.

`live-viewer.tsx` reads geometry through this bridge (`ApiReplayScenarioSource`), so
`?scenario=<name>` now works for any scenario the bridge can resolve — not just the ones bundled
in `public/data/`. The `/simulator/replay` page ("Ver replay" button on `/simulator`) is the
**replay mode**: it loads `segments.arrow` through this bridge and plays it back over a fixed
`[tickMin, tickMax]` range with a scrubber (play/pause/speed).

## Adding components

To add components to your app, run the following command at the root of your `web` app:

```bash
pnpm dlx shadcn@latest add button -c apps/web
```

This will place the ui components in the `packages/ui/src/components` directory.

## Using components

To use the components in your app, import them from the `ui` package.

```tsx
import { Button } from "@workspace/ui/components/button";
```
# htc-view
# htc-view
