# htc-ui live visualization — status & handoff

Written 2026-08-26 so the next engineer (human or Claude) can pick this up without re-deriving
the state of the live visualization.

> Runbook (como subir tudo): veja [RUNNING.md](RUNNING.md).

> Update 2026-11-01: the findings below retain their original historical verification.
> See [Real-time and maps](REAL_TIME_AND_MAPS.md) for the current distinction between live
> observation, 1× playback and unimplemented engine wall-clock pacing, the shared OSM basemap,
> and the remaining paced-execution gaps. [Managed live runs](MANAGED_LIVE_RUNS.md) now connect
> full MICRO, MESO and mixed jobs with snapshot geometry, isolation and readiness; real
> concurrent-run/results/replay checks passed, with browser acceptance pending.
> The bounded [entity/map editor](SCENARIO_ENTITIES_EDITOR.md) is now implemented;
> the broader [map editor proposal](MAP_EDITOR_SPEC.md) records remaining GIS extensions.
> Fresh native run/replay evidence is linked there separately.

## Current state

The live simulation visualization inside `htc-ui` is functional end-to-end:

- `/simulator` is the engine control panel. Its **Cenários** panel
  (`apps/web/components/scenarios-panel.tsx`) lists/loads scenarios through the engine REST API
  (`apps/web/lib/htc-api.ts` → `/scenarios`, `/scenarios/:name`, `/scenarios/:name/load`) and
  starts/pauses/stops the engine.
- `/simulator/live` renders vehicles on a map in real time. It is a thin
  `next/dynamic({ ssr: false })` wrapper around
  `apps/web/components/live/live-viewer.tsx`, ported from `htc-replay/web`
  (deck.gl + maplibre-gl + apache-arrow + zustand).
- Live data flow: engine `kafka` report strategy → Kafka topics
  `dev.htc.simulation.{vehicle,link,person}-states.v1` plus `dev.htc.simulation.metrics.v1`
  (MICRO updates) → `htc-bus-live` WebSocket
  (`GET /ws/live`, default `ws://localhost:8090/ws/live`, configurable via
  `NEXT_PUBLIC_HTC_LIVE_WS_URL`) → `apps/web/components/live/live/useLiveSegments.ts` →
  `liveSegmentStore.ts` (incremental MESO/MICRO/walking segment derivation) → the exact same
  `SegmentsTable` rendering pipeline the file-replay mode uses.
- Static geometry (`links.arrow`, `nodes.arrow`, `signals.json`, `stops.json`, `rail_links.arrow`,
  `manifest.json`) still comes from the batch ETL, bundled at `apps/web/public/data/<scenario>/`
  (`htc_hybrid_demo`, `htc_qa_full`). Live events carry only positions, never geometry.

## What changed this session

1. **Scenario wiring** — `/simulator` now remembers the scenario loaded in the Cenários panel
   (`activeScenario` state) and passes it through the "Ver visualização ao vivo" button as
   `/simulator/live?scenario=<name>`. The live viewer already read `?scenario=`
   (`live-viewer.tsx` → `scenarioIdFromUrl`), so this closes the loop: the live map opens on the
   same scenario the human selected in the htc-ui scenario selector, instead of always defaulting
   to `htc_hybrid_demo`.

2. **Human-controlled visualization time (time dilation)** — new
   `apps/web/components/live/timeline/`:
   - `livePlaybackStore.ts` — a zustand playback clock (`currentTick`, `tickMax`, `isPlaying`,
     `followLive`, `speedMultiplier`).
   - `useLivePlaybackLoop.ts` — a `requestAnimationFrame` loop that advances `currentTick` at
     `speedMultiplier * ticksPerSecond`, capped at the live edge (`tickMax`).
   - `LiveTimelineScrubber.tsx` — bottom bar with play/pause, a scrubber over the captured live
     window, a speed selector, and an "Ao vivo" button that re-attaches to the live edge.
   - `live-viewer.tsx` now passes `currentTick` (the playback clock) to `MapView` instead of the
     raw `latestTick`, so a human can pause/scrub/slow down a scenario that executes in a couple of
     wall-clock seconds.

3. **Replay mode ported into htc-ui** — new `/simulator/replay` route + `ReplayViewer`
   (`apps/web/components/live/replay-viewer.tsx`) loading `segments.arrow` through the bridge and
   playing it over a fixed `[tickMin, tickMax]` range, reusing the same `MapView` pipeline. New
   `apps/web/components/live/timeline/replayPlaybackStore.ts`, `useReplayPlaybackLoop.ts` and
   `ReplayTimelineScrubber.tsx` (mirroring `htc-replay/web`'s `playbackStore`/`usePlaybackLoop`/
   `TimelineScrubber`). A "Ver replay" button on `/simulator` links to
   `/simulator/replay?scenario=<name>`.

## Playback clock behavior

- Default is `followLive = true`: `currentTick` tracks `tickMax` (the live edge) as events arrive —
  the same "watch it as it happens" behavior as before.
- Pausing or scrubbing flips `followLive` off. "Tocar" then advances from the scrub position at
  `speedMultiplier` simulated-seconds per real second (`1x` = real time), never past the edge.
- "Ao vivo" jumps back to the edge and resumes following.

## Replay bridge (Phase 2)

Scenario geometry and full-run replay both need files on the engine host's filesystem
(`HTC_SCENARIOS_DIR/<name>/data/`, `HTC_REPORT_PARQUET_DIRECTORY/<name>/*.parquet`), which the
browser can't reach. New `/api/replay/*` route handlers (`apps/web/app/api/replay/`) bridge that
gap (local/dev only):

- `GET /api/replay` — lists scenarios and what it can locate for each (geometry `data/`, Parquet
  file count, already-generated artifacts) plus the resolved paths.
- `GET /api/replay/<scenario>` — `not_generated` | `generating` | `ready` | `error`.
- `POST /api/replay/<scenario>` — runs the htc-replay ETL via `sbt run` (the compiled jar is
  **thin**, no bundled deps — `java -jar` fails with `NoClassDefFoundError: scopt.OptionParser`) to
  derive `segments.arrow` + geometry from Parquet, asynchronously.
- `GET /api/replay/<scenario>/<file>` — serves one artifact (generated output first, then the
  bundled `public/data/` copy). Only the known artifact filenames are ever read.

Paths live in `apps/web/lib/replay-config.ts` (env-overridable with machine-local defaults).
`live-viewer.tsx` now reads geometry through `ApiReplayScenarioSource` (the bridge), so
`?scenario=<name>` works for any scenario the bridge can resolve, not just bundled ones.

Verified end-to-end against `htc_qa_full`: `POST` → `sbt run` → `ready` with all 7 artifacts in
`HTC_REPLAY_OUT_DIR/htc_qa_full/`, served back over `GET /api/replay/htc_qa_full/<file>`.

Parquet path note: the canonical directory is
`/home/dean/hyperbolic-time-chamber/output/reports/parquet` (code default
`/app/hyperbolic-time-chamber/output/reports/parquet` in `application.conf`, mounted from the host
by `docker-compose.yml`). The earlier demo scenarios (`htc_hybrid_demo`, `htc_qa_full`) wrote their
Parquet into the older scratch `output_local/reports/parquet/` — re-run them or move those files for
the bridge to see them under the canonical path.

## Known limitations / next steps

- The live `LiveSegmentStore` keeps a finite trailing window (`DEFAULT_WINDOW_TICKS = 600`,
  ~10 simulated minutes at 1 tick/s) and prunes older closed segments, so scrubbing back further
  than that shows an empty map. Small scenarios — the motivating case — fit entirely in the window.
  Full-run rewind is now covered by the **replay mode** (`/simulator/replay`), which loads
  `segments.arrow` (via the bridge) and plays it over a fixed `[tickMin, tickMax]` range.
- `htc-bus-live`'s Kafka consumer subscribes with `auto.offset.reset=latest` (see
  `scripts/run-live-demo.sh`), so events produced before the live page opens are not captured — the
  viewer must already be open while the engine runs. The Parquet/replay path above is the answer
  for "the run finished before I opened the page".
- Emissions are still `hasEmissions=false` / NaN in live mode (the live tap doesn't carry them).
- Node tests now cover managed live geometry, run filtering, MICRO/MESO store behavior,
  replay identity and OSM geometry. Browser/WebGL acceptance remains pending.
