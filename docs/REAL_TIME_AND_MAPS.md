# Real-time execution and OpenStreetMap

Status checked against the current checkout on 2026-11-01. This distinguishes current
capabilities from the work proposed for the map editor.

Component roles and the user's required standalone/OSM-backed modes are defined in
[Simulation map modes](SIMULATION_MAP_MODES.md). SimEDaPE is an acceleration technique;
full HTC execution and HTC View replay are not instances of that technique.

## What can run in real time?

| Capability | Current status |
|---|---|
| Watch a simulation while HTC executes | Engine Kafka reporter → `htc-bus-live` → WebSocket → `/simulator/live`. Managed MICRO, MESO and mixed runs have fresh [live integration evidence](MANAGED_LIVE_RUNS.md). |
| Watch recorded output at 1× | Implemented replay clock: one simulated second per wall-clock second of playback. The completed native run/replay integration has fresh [verification](../../simedape/docs/NATIVE_VIEW_INTEGRATION.md). |
| Watch captured live data at 1× | Implemented when playback leaves “follow live” mode. The viewer advances at the chosen speed and waits at the available-data edge. |
| Force HTC itself to execute at 1× wall-clock pace | Not implemented in the conservative native path inspected here. `tickDuration` defines physical seconds per simulation tick; it is not a rate limiter. |
| Stream the new managed full HTC run directly into HTC View | Implemented as an opt-in: snapshot geometry, run-filtered WebSocket and consumer/viewer readiness before JVM launch. Real MICRO, MESO and mixed cases passed; browser/WebGL acceptance remains pending. |

The distinction matters in practice: the verified synthetic scenario covers 180 simulated
seconds, while native execution/publication took about 20 wall-clock seconds, including
startup and reporting. Playing that recording at 1× takes roughly three minutes. A viewer
clock cannot make the engine execute in real time.

The live page defaults to following the latest available tick. Pause/scrub, then play at 1×
to watch captured data at that pace. The “Ao vivo” action reattaches to the arriving edge.
Live viewing can lag, and the source currently starts from Kafka's latest offsets; opening
the page late does not restore the whole run's history.

Relevant code:

- [Native adapter](../../simedape/experiments/htc.py): assembled engine execution, Parquet plus optional Kafka reporter configuration and committed completion.
- [Live source](../../htc-bus/htc-bus-live/src/main/scala/org/interscity/htc/bus/live/source/RedpandaLiveSource.scala): latest-offset Kafka source and broadcast hub.
- [Live playback loop](../apps/web/components/live/timeline/useLivePlaybackLoop.ts) and [state](../apps/web/components/live/timeline/livePlaybackStore.ts): follow-edge and controlled playback.
- [Conservative time manager](../../hyperbolic-time-chamber/src/main/scala/core/actor/manager/time/ConservativeGlobalTimeManager.scala): advances according to simulation work, not a wall-clock pacing target.

## OpenStreetMap visualization

Both `/simulator/live` and `/simulator/replay` share [MapView](../apps/web/components/live/map/MapView.tsx).
It supports an independent background or an OpenStreetMap raster background through MapLibre.
The synthetic demo now defaults to the independent background; its links are not OSM streets.
Roads, vehicles and signals remain HTC/deck.gl overlays. No replacement map framework is needed;
MapLibre directly supports [raster tile sources](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-raster-tile-source/).

Configuration is in [map-config.ts](../apps/web/lib/map-config.ts):

| Variable | Behavior |
|---|---|
| `NEXT_PUBLIC_HTC_MAP_BACKGROUND` | `none` (default independent background) or `osm`. This controls visual background only; it does not certify the simulation network as OSM-compatible. |
| `NEXT_PUBLIC_HTC_MAP_STYLE_URL` | Optional complete MapLibre style URL when background is `osm`; overrides the default raster background. |
| `NEXT_PUBLIC_HTC_OSM_TILE_URL` | XYZ raster tile template; defaults to `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. |
| `NEXT_PUBLIC_HTC_MAP_ATTRIBUTION` | Attribution for a custom raster source; defaults to linked OpenStreetMap contributor credit. |

These are browser/build-time variables. Restart development Next.js after changes, or rebuild
a production deployment. Full attribution is rendered without a collapsed toggle, below the
top-left status badge. Check that it remains visible in the actual target viewport and when
panels open. Style URLs carry their own source attribution; configure it in the chosen style.

The public OSM tile service is for normal interactive viewport requests. Keep attribution
visible, use HTTPS, preserve browser Referer and normal HTTP caching, and do not add tile
prefetching, scraping or offline downloads against that service. Larger deployments or offline
maps need a suitable provider or self-hosted service; the provider configuration allows switching.
These requirements come from the [OSMF tile usage policy](https://operations.osmfoundation.org/policies/tiles/).

### A background map does not create a simulation network

Showing OSM streets does not automatically import their topology, lanes, speeds, turn
restrictions or traffic demand into HTC. Those require a scenario import/conversion step.
The current `native-two-corridors-map` fixture is synthetic and only anchored near Paris
for display. Its vehicles do not represent traffic on actual Paris streets.

OSM-backed scenarios retain validated source polylines; roads and vehicles use those curves
in live and replay, with joined road/link inspection. Standalone scenarios use their own
topology. See [the OSM workflow](OSM_IMPORT_WORKFLOW.md) for its bounded input profile.

## Managed live milestone and next work

The [managed live runbook](MANAGED_LIVE_RUNS.md) records implementation, configuration and
real concurrent-run evidence for snapshot geometry, optional Kafka alongside Parquet,
server/client isolation and consumer/viewer readiness. MESO traversal visualization and
measurement semantics are explicit; mixed networks retain each link's level. Final results
and replay passed for all four fixtures. Interactive browser acceptance remains next.
Reconnect follows the live edge; the retained 600-tick buffer is not durable run history.

If the requirement is **paced execution**, add an explicit engine mode after that live milestone:
use a monotonic wall-clock anchor and committed simulation progress, release work at the requested
rate, and expose lag when the machine cannot keep up. Use scheduled actor messages rather than
blocking actor threads. Pause/resume must adjust the anchor; pacing must not rewrite event ticks,
drop simulation work or change physics. Verify output equivalence with unpaced execution and
measure pacing/lag separately. This is proposed behavior, not an available setting today.

## Verification boundary

The basemap change is shared by both viewers and type-checks against the installed MapLibre
and react-map-gl versions. Production build and targeted lint are checked with the change.
Browser/WebGL and visible attribution acceptance remain pending because no browser is exposed
to the browser tool in this session. No automated tile fetching or bulk map download was used.
Real managed live Kafka runs are recorded in [the managed-live evidence](MANAGED_LIVE_RUNS.md).
The bounded [entity/network editor](SCENARIO_ENTITIES_EDITOR.md) is now implemented;
broader GIS tools and engine wall-clock pacing remain proposals.

### Live subway movement

The scenario-backed Live viewer resolves `subway_id` as the Subway sprite kind and joins
movement events against both road and rail geometry. Previously the live segment store
omitted Subway identity and rail-link geometry, silently discarding rail-only movement;
Replay ETL already supported both. Actor IDs accept strings or safe JSON integers for all
transport kinds, including bicycles and pedestrians. Train rendering requires the source
scenario's exported rail geometry and actual `enter_link`/`leave_link` events; boarding
counters alone are not position observations. Garage SubwayStation inputs embed train
schedules in `subways` and rail routes in `linesRoute`, spawning Subway actors at runtime,
so a separate `subways_*.json` actor file is not required. This repair does not expand the
bounded managed-live adapter to support transit scenarios.
