# Managed HTC runs: MICRO, MESO and mixed live viewing

Implemented and exercised with real HTC, Kafka/Redpanda and WebSocket traffic on
2026-11-01. HTC is the simulator engine; HTC View is the platform UI. This is a full
execution integration, not the SimEDaPE acceleration technique or an accuracy improvement.

## Use it

1. Open **Execuções HTC** (`/simulator/runs`) in HTC View.
2. Select a supported scenario. Options identify MICRO, MESO or both, and OSM when
   the scenario has verified source geometry.
3. Select **Acompanhar este run ao vivo**, then **Abrir ao vivo e executar HTC**.
4. The run page loads its own immutable geometry and opens its scoped stream. HTC starts
   after the map renderer initializes and the API verifies the active subscription.
5. Follow the arriving events, or pause/scrub/play the retained window. Use **Resultados**
   for measurements and **Replay completo** after completion for the whole run.

The isolated review instance is <http://localhost:3002/simulator/runs> (API :5004, bridge
:8091, broker :19092). Shared :3000/:5000 and earlier :3001/:5003 were not restarted.
Existing test runs are completed; services remain available for another run. The review
instance contains this integration; unrelated newer Claude UI work may require its own build.

The supported managed profile is bounded JSON scenarios with independently scheduled,
fixed-route Car actors, Node/Link, optional TrafficSignal/RoutingService, conservative
discrete-event execution, startTick=0 and one-second ticks. Link modes may be MICRO, MESO
or mixed. Person/transit/owned vehicles, dynamic mode choice, plugins, SQLite and optimistic
execution still require further adapter work. The wider engine supports more than this profile.
The bounded OSM importer still creates its documented single-lane MICRO profile; existing
MESO/mixed input packages can be executed without pretending that importer generates them.

## Geometry, identity and launch ordering

The job materializes the selected scenario before launching its JVM, assigns the managed
run ID as its simulation ID, then prepares `live-geometry.json`. This includes exact string
IDs, topology, link simulation modes, signals, physical clock, bounds and optional retained
OSM polylines/source mapping. Geometry and all snapshot inputs are fingerprinted. Later
catalogue edits cannot silently change a running or completed run's map.

The managed viewer uses `/simulator/live?run=<run-id>`, not a bundled demo map. Standalone
networks keep their own geometry; OSM-backed networks retain source way/direction and full
curves. The shared renderer and link inspector consume those same mapped roads.

The launch barrier requires all of these:

- The bridge has assigned all four required Kafka topics and resolved its starting offsets.
- The viewer has downloaded and verified this run's geometry hash, and initialized MapView.
- Its scoped WebSocket has received `stream_ready` with run, connection and bridge identity.
- The API verifies the geometry/token and checks that connection is still active on that
  bridge, then rechecks immediately before authorizing JVM launch.

Wrong geometry, another run's subscription and inactive connections are refused. If no
viewer becomes ready within the configured timeout, the job fails before starting HTC.
A disconnect after launch does not pause the simulation. Reconnection follows the live edge;
missed history is available through committed Parquet and final replay.

Both the bridge and client/store filter run identity before changing ticks or vehicle state.
Replacing the selected run replaces geometry, socket and buffers. Out-of-order motion from
different Kafka topics cannot reopen a vehicle after a newer exit. The bridge gives each
process its own consumer group suffix so separate bridge processes do not split the stream.

## MICRO and MESO semantics

| Level | Live map | Final managed measurements |
|---|---|---|
| MICRO | Position updates chain short segments; link exit closes the traversal. | Existing microscopic sample speed and available acceleration/deceleration/leader gap; count/flow from entry/exit coverage. |
| MESO | Entry opens a provisional traversal from reported travel time; actual exit closes it. Motion along the road is visualization interpolation. | Count/flow from entry/exit; speed in m/s = link length / actual completed traversal duration, weighted over its interval. |
| Mixed | The same vehicle can travel across both link modes in one run and geometry. | Each link retains the semantics of its level. MESO acceleration/deceleration/gap remain missing. |

An unfinished MESO traversal contributes occupancy but no derived speed. Missing values stay
missing in the API, downloads and charts. MESO interpolation is not a microscopic trajectory.
Managed MESO/mixed datasets are explicitly `managed_full`, profile
`htc.managed-link-measurements.v1`; receipt and result metadata explain the measurements.
This opt-in path rejects reduced scenarios. The default scientific adapter and its
MICRO observation/masking contract remain unchanged.

## Configuration

The existing Flask API hosts the managed HTC endpoints; its historical SimEDaPE URL setting
does not change the component's role. Configure the API process with:

```bash
export SIMEDAPE_HTC_ENGINE_JAR=/absolute/path/to/engine.jar
export SIMEDAPE_HTC_SCENARIOS_DIR=/absolute/path/to/scenarios
export SIMEDAPE_HTC_OUTPUT_DIR=/absolute/path/to/managed-output
export HTC_MANAGED_LIVE_BRIDGE_URL=http://127.0.0.1:8091
export HTC_MANAGED_LIVE_WS_URL=ws://localhost:8091/ws/live
export HTC_MANAGED_LIVE_KAFKA_BROKERS=127.0.0.1:19092
export HTC_MANAGED_LIVE_KAFKA_PREFIX=managed
export HTC_MANAGED_LIVE_VIEWER_TIMEOUT=180
```

The bridge HTTP URL is reachable from the API host; the WebSocket URL must be reachable
from the user's browser. Configure the bridge process with the same broker and prefix:

```bash
export HTC_BUS_KAFKA_BROKERS=127.0.0.1:19092
export HTC_BUS_LIVE_HOST=127.0.0.1
export HTC_BUS_LIVE_PORT=8091
export HTC_BUS_LIVE_GROUP_ID=htc-managed
export HTC_BUS_LIVE_SIMULATION_TOPICS='["managed.htc.simulation.vehicle-states.v1","managed.htc.simulation.link-states.v1","managed.htc.simulation.person-states.v1","managed.htc.simulation.metrics.v1"]'
# From htc-bus: sbt 'live/assembly', then run the assembled live jar.
```

Create those four topics before running. **`micro_update` is published to `metrics.v1`**;
subscribing only to vehicle/link/person topics loses microscopic position updates. The
adapter configures Kafka alongside Parquet, including the engine publisher's actual
`htc.brokers.kafka.bootstrap-servers` key, a one-event Kafka batch and the matching prefix.
Non-live runs continue to use Parquet alone.

HTC View needs `NEXT_PUBLIC_SIMEDAPE_API_URL=http://localhost:5004` at build time and
`SIMEDAPE_API_URL=http://127.0.0.1:5004` for its server replay bridge. Configure
`HTC_REPLAY_OUT_DIR` and `HTC_REPLAY_ETL_DIR` as in the existing replay runbook. No bundled
Arrow geometry needs to be generated before opening a managed live run.

Useful protocol routes:

| Endpoint | Purpose |
|---|---|
| API `GET /api/htc/scenarios` | Scenario modes and live configured/ready/reason. |
| API `POST /api/htc/runs` | Existing scenario/bin request plus optional `live: true`. Returns live page URL. |
| API `GET /api/runs/<id>/native/live` | `preparing_geometry`, `awaiting_viewer`, `streaming`, `completed` or `failed`. |
| API `GET /api/runs/<id>/native/live/geometry` | Verified snapshot geometry; no-store. |
| API `POST /api/runs/<id>/native/live/ready` | Geometry hash/token and active WS connection/bridge identity. |
| Bridge `GET /health`, `GET /sessions/<connection-id>` | Consumer/topic and active subscription readiness. |
| Bridge `/ws/live?simulationId=<id>` | Server-filtered managed subscription. |

Legacy `/ws/live` and `/simulator/live?scenario=...` remain available for the general engine
viewer. Their unscoped behavior is not the managed isolation/readiness guarantee.

## Verification and remaining acceptance

Retained evidence: [managed-live validation](../../simedape/docs/validation/htc-managed-live-2026-11-01.json).
Raw event captures, downloaded receipts/datasets, input geometry and Arrow replay artifacts
are under `/tmp/htc-managed-live-20261101`.

| Scenario | Live proof | Final results/replay |
|---|---|---|
| MICRO standalone, 4 links/5 nodes | 614 MICRO updates, concurrent with OSM run | 864 API cells checked; 32 replay segments, 16 cars. |
| MICRO OSM, 34 links/17 nodes | 699 MICRO updates | 36,720 API cells checked; 30 replay segments, 16 cars. |
| MESO standalone, 4 links/5 nodes | 32 entries/32 exits; zero fabricated MICRO updates | 864 API cells checked; 32 replay segments, 16 cars. |
| Mixed OSM, 17 MICRO + 17 MESO links | 377 MICRO updates and 14 MESO entries/exits | 36,720 API cells checked; 30 replay segments, 16 cars. |

Each pair ran concurrently against the same broker. Motion arrived while managed status
was still `running`; wrong hashes and inactive subscriptions could not unlock launch;
bridge/client isolation and geometry identity passed. MESO microscopic metric masks are
absent as required. A same-JAR MICRO live/non-live control produced identical 36,720 values,
missing masks, time and labels. No physics, estimator or accuracy threshold was changed.

Python contract/regression tests, Node geometry/store/replay tests, bridge assembly,
targeted lint and the isolated View production build passed. **Browser/WebGL interaction
has not been accepted**: the browser tool exposes no browser in this session. Next is the
interactive check of map initialization, visible attribution, road picking, level labels,
pause/scrub/reconnect, and results/replay navigation for MESO and mixed runs as well as MICRO.

Live observation is not engine wall-clock pacing. The captured store retains a trailing
600 ticks, not durable whole-run history. Replay remains the complete recovery path.
Production durable multi-worker orchestration, broader actors/inputs and paced execution
are separate gaps; this integration does not establish a ClickHouse round trip.
