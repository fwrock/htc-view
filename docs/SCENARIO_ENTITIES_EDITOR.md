# Scenario entities and map editor

Implemented on 2026-11-01 under **Modificações → Entidades e mapa** (`/modifications`).
The existing **Operações what-if** editor remains available alongside it. This is HTC
scenario authoring and execution preparation, independent of the SimEDaPE acceleration technique.

Review: <http://localhost:3004/modifications?ref=osm-demo:osm-screen-v1> (OSM), or select
`editor-demo:editor-transit-ready` for the verified multimodal example. This isolated View
uses API :5006. Shared :3000/:5000 and previous review services were preserved.

## Editing workflow

1. Choose a registered base scenario and **Criar rascunho**, or reopen a saved draft.
2. Click a road, node, signal, station or stop on the map, or find it by type/name/ID in the
   entity list. Edit its fields and **Aplicar ao rascunho**. Unapplied fields are retained
   when switching editor tabs; apply or explicitly discard them before changing selection.
3. Use **Adicionar nó**, **Conectar via**, **Conectar trilho**, or **Mover nó** on the map.
   Connections are directed. Pan/zoom and **Enquadrar rede** navigate the map.
4. **Desfazer/Refazer** operates on committed editor actions, including multi-entity changes.
   Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y work outside text inputs. Native input undo is preserved.
5. **Salvar rascunho** persists its document and history on the server, including unfinished
   or invalid work. Browser recovery also caches local edits. Exporting a draft produces its
   editor JSON, not a runnable scenario package.
6. **Validar** lists actionable errors. Click an entity's error to open it. Correct references,
   routes and service definitions; missing vehicles on an infrastructure-only line are warned.
7. Choose a new revision name and **Validar e publicar nova revisão**. The API validates
   again and publishes a new sibling scenario package. Select that revision in the general
   HTC **Simulador** to execute it. Independently scheduled fixed-route car scenarios can
   also use **Execuções HTC**; that managed adapter still excludes public-transport actors.

The selected engine must be able to access the published location's paths. Publication does
not start/restart an engine, change its active scenario, or overwrite the base/revision.

## Supported entities and actions

| Area | Available editing |
|---|---|
| Topology | Create/move/delete nodes; create directed road/rail connections; change endpoints; delete links. Dangling references block publication. |
| Roads | Length, lanes/configuration, speeds, capacity, MICRO/MESO mode and microscopic step settings. Split an ordinary road in one action; fixed vehicle/walking routes and signal approach references are repaired. Advanced junction/lookahead roads need explicit reconfiguration before splitting. |
| Signals | Controlled nodes, cycle/offset, approach road and green start/duration per phase. Overlapping phases for the same approach or intervals beyond the cycle are rejected. |
| Metro | Stations, terminals/garages, rail links and their station endpoints; ordered lines, headways, train departures, and advanced native dispatch fleet/route fields. |
| Bus | Stops bound to nodes, terminals and dispatch fleets, ordered lines/headways, fixed-route bus departures and stop mappings. |
| Demand | Edit Car/Person/Bus/Subway/Bicycle/Motorcycle actors; departure times, endpoints, routes and native plan fields. Generate 1–1000 cars, walking people, bus passengers or metro passengers as one undoable action. |
| Lines | Ordered stops and travel times, mode, label and headway. Applying an edit synchronizes matching vehicles and dispatch definitions; explicit departure times are preserved. **Criar partida desta linha** builds a bus/train route and stop map. |
| Drafts | Server persistence, browser recovery, export, version checks, explicit discard/reopen, and up to 100 undoable actions, retained across saves/reloads. |

Native complex fields (person plans, ownership/dependencies, dispatch fleet definitions and
advanced physics settings) also have JSON editors. Invalid JSON blocks applying the form;
valid JSON with semantic errors can remain in a draft, but cannot be published.

Bus terminals currently follow the engine's numeric stop-ID order and require outgoing and
return road routes. The validator reports when a chosen line order cannot use that terminal;
use the fixed-route bus departure workflow for arbitrary supported ordered stops.

Vehicles board passengers on arrival at a stop. The line departure builder therefore includes
outgoing and return paths: the initial boarding stop is served in subsequent cycles. A line's
ordered passenger-routing stops remain distinct from its vehicle's operational return cycle.
Static metro trains are published with explicit inherited `movableBestRoute`/`movableStatus`
fields, so they do not accidentally request a road route at startup.

## OpenStreetMap and standalone mode

OSM-backed drafts open on an OpenStreetMap background with visible attribution. Road selection
shows its source street name and way ID. The matching full road shapes/source snapshot remain
bound to the scenario; editing signals, transit, demand and road properties preserves that mapping.
No changes are uploaded to the public OpenStreetMap database.

Moving source nodes or freely adding/removing roads would break the current strict source
contract. Those map tools are protected while the revision is OSM-backed. Use the explicit,
undoable **Tornar esta revisão independente** action for free topology editing. The resulting
package keeps its own graph and records its ancestry, but no longer claims OSM correspondence.
Changing a tile background alone never changes the network's compatibility status.

Standalone editing uses geographic display coordinates and its own network background.
General Cartesian projection, arbitrary curve-vertex editing, source-preserving OSM resegmentation
and a city-scale GIS workflow are further extensions. JSON actor packages are supported here;
SQLite sources must first be converted with the platform's canonical converter. Remote locations
without a local writable provider are not publication targets for this editor.

## Validation and publication contract

- Draft document schema: `htc.scenario-draft.v1`. IDs stay decimal strings through the browser,
  including signed 64-bit IDs and reserved identities in bus/train dispatch fleets.
- Validation covers actor descriptors, duplicate identities, referenced classes, node/link
  connectivity, routes, signal timing/approaches, rail/station alignment, stop mappings,
  line service/demand correspondence, MICRO clock constraints and the OSM source contract.
- Passenger plans require a service that actually visits boarding and alighting nodes.
  An unused line is a warning; a passenger assigned to an unserved stop is an error.
- Structural dependencies, node incidence, signal initial state and transit-map coordinates/
  memberships are derived from the edited entities. Other actor fields/ownership are preserved.
- The road `city_map.json` contains **road Link edges only**. RailLink actors form their separate
  network, and metro routes carry explicit rail IDs. Mixing rails into the road graph can send
  buses onto rail links; the publication test guards this separation.
- The published package owns JSON sources, road/transit maps, simulation configuration and
  `editor-provenance.json`. New dynamic Bus/Subway classes receive the necessary empty source
  registrations. OSM revisions retain their source extract and verified geometry sidecar.
- Input fingerprints must still match the base at publication. Stale source edits and stale
  draft versions fail instead of silently replacing someone else's work. File locks serialize
  editor saves/publication; Linux `renameat2(RENAME_NOREPLACE)` publishes the staged directory
  atomically without replacing an existing revision, including an empty directory.

## API and setup

The existing platform Flask API registers the editor blueprint. It requires `htc-locations`
and the same actor descriptors used by the operations editor. Set
`SIMEDAPE_SCENARIO_DRAFTS_DIR` to persistent storage (default: platform
`output/scenario-drafts`). HTC View uses its existing `NEXT_PUBLIC_SIMEDAPE_API_URL` setting;
the historical environment name does not classify this workflow as SimEDaPE acceleration.

| Endpoint | Purpose |
|---|---|
| `GET /api/scenario-editor/drafts[?ref=...]` | List saved drafts. |
| `POST /api/scenario-editor/drafts {ref}` | Snapshot a base scenario and create a draft. |
| `GET /api/scenario-editor/drafts/<id>` | Reopen document/history/version. |
| `PUT /api/scenario-editor/drafts/<id> {version,document,history}` | Save even invalid draft content; refuse stale versions. |
| `POST .../<id>/validate {document?}` | Validate saved or current candidate content, including base fingerprints. |
| `POST .../<id>/route {document?,origin,destination,via?,rail?}` | Compute a directed road or rail path from the candidate entities. |
| `POST .../<id>/publish {version,revision}` | Revalidate and publish a new immutable scenario revision. |

Existing `htc.modifications.v1` operations are unchanged. Reserved `map.*` operations are
still not engine operations: this editor materializes complete scenario revisions instead.

## Verification

Retained [validation evidence](../../simedape/docs/validation/htc-scenario-editor-2026-11-01.json)
records draft/API, undo/redo, OSM and actual HTC checks. Raw packages, logs and Parquet are in
`/tmp/htc-editor-20261101`. The final verified revision is
`editor-demo:editor-transit-ready` (3 nodes, 4 roads, 4 rails, 3 bus stops, 3 metro stations,
1 bus terminal, 1 signal, 2 cars, 2 buses, 2 static trains and 4 people, plus dispatch fleets).

The real engine committed completion with zero error-level log entries. Both PT passengers
boarded/alighted and completed their trips (bus at tick 97, metro at tick 73); both walking
trips completed. MICRO/MESO traffic, signal phase changes and BusStation/SubwayStation births
were observed. The same frozen JAR was used throughout; no engine physics or accuracy threshold
was modified. Earlier failed attempts are preserved and are not acceptance evidence.

Python contract/regression tests, Node history/geometry/replay tests, targeted ESLint and the
isolated production build passed. Browser/WebGL interaction remains **pending**: CUA reports
no browser. HTTP rendering and scripted API traffic do not establish visual acceptance.

Reusable authoring check (against the bounded `tests.test_scenario_editor.make_scene` fixture):

```bash
cd htc-ui/apps/web
NEXT_PUBLIC_SIMEDAPE_API_URL=http://localhost:5006 \
node --experimental-strip-types scripts/check-scenario-editor.mjs \
  --scenario editor-demo:editor-multimodal-smoke-v2 \
  --revision another-editor-proof --output /tmp/another-editor-authoring.json
```

Strict real-engine check, from the platform root and the installed pipeline environment:

```bash
python scripts/check-scenario-editor-engine.py \
  --scenario /absolute/path/to/published/simulation.json \
  --engine-jar /absolute/path/to/engine.jar \
  --output /tmp/editor-engine-proof --require-mixed-transit
```

The latter requires actual mixed-level traffic, bus/metro births, boarding/alighting and
completed passenger/walking trips. A generic completion marker alone is insufficient.
