# OSM-backed mode: status and handoff

## Codex update — HTC View import screen and endpoints

The [HTC View workflow](OSM_IMPORT_WORKFLOW.md) is implemented at `/simulator/import`,
using background jobs, registered source/destination locations, map/diagnostic preview and
review-bound publication. Its actual API client completed a real import and started HTC;
run `bade65025d6d47dcab5420bc125a9af6` passed results/replay/map checks. Standalone run
`39659a188eba40e9a1af46431255d29f` also passed. Seven new HTTP tests plus nineteen API
regressions passed. The isolated review stack is :3001/:5003, preserving Claude's shared
:3000/:5000 stack. Fresh browser acceptance and shared API reload still need coordination.
This supersedes the earlier no-import-screen statements below.

## Codex update — reusable bounded importer

The [preview/publish importer](../../tools/osm_scenario/IMPORT_WORKFLOW.md) now selects
whole intersecting OSM ways from XML/gzip, reports unsupported rules and connectivity,
and atomically publishes a new canonical HTC revision. It has 18 passing converter/importer
tests. A regional-file selection of 11 ways produced 34 links / 17 nodes and passed real
HTC execution, HTTP results, replay and geometry audits in run
`089d73f5d13d456485c939bb14093dee`. This supersedes the historical fixed-fixture-only item
below. No import screen or endpoints were added. The next seam is documented in the
workflow and `AGENT_COORDINATION.md`; fresh browser acceptance remains requested.

## Codex update — validated pipeline and kernels

The current [implementation/verification record](OSM_COMPATIBILITY_VALIDATION.md) supersedes
the initial “not done” test/regression items below. The OSM HTTP/replay run
`bcebd1d85d41419ba54cff5f8ae8a330` and standalone regression
`815621b601c14af19b3fa0bc22dc5737` passed. Added source/converter tests, ordinary/worker
geometry tests, a `PathLayer`/picking payload test and full-shape-bounds regression.
Fresh combined browser acceptance remains requested from Claude in the coordination file.
The original handoff below is preserved as historical context, including its browser evidence.

Coordenação ativa entre Codex e Claude: ler e atualizar
[`AGENT_COORDINATION.md`](../../AGENT_COORDINATION.md) antes de editar áreas compartilhadas
ou reiniciar a stack. Registro do Codex em 2026-11-01 14:04 UTC: testes de geometria e
regressão standalone estão sob sua responsabilidade; migração das páginas/locations/engines
está sendo preservada. O run `bcebd1d85d41419ba54cff5f8ae8a330` completou; o smoke antigo
precisa acompanhar `/simulator/runs` e o catálogo com nomes qualificados por location.

Written 2026-11-01 for the next agent. Read `SIMULATION_MAP_MODES.md` first (the two-mode contract).
Another agent was working on HTC View usability in parallel; avoid reverting its edits (the tree is not under git here, so do not "restore" files).

## What works (verified)

Bounded proof only: 2 real São Paulo OSM ways -> 6 directed HTC MICRO links, synthetic fixed-route car demand.

- Fixture: `tools/osm_scenario/convert.py` (+ `examples/sao-paulo-two-roads.osm`). Writes `data/road_network.json` (per-link shape, OSM way id, node sequence, name, direction, tags) and `data/road_source.osm`.
- Backend: `simedape/experiments/road_network.py` validates the sidecar against the saved OSM extract; `api/native.py` reports `map_mode: osm|standalone`; `api/native_replay.py` and `experiments/materialize.py` carry `road_network.json` into the verified replay package (sha256 in the descriptor).
- Frontend (`htc-ui/apps/web`): `components/live/map/roadGeometry.ts` (index/pack/position-on-road), used by `vehicleScatterLayer.ts`, `workers/vehicleWorker.ts`, `segmentBuffers.ts`, `linkLayer.ts`; `LinkPanel.tsx`/`LinkTooltip.tsx` show OSM name, way id, direction, sibling HTC links, source tags.
- `scripts/run-native-integration-demo.sh` generates the OSM scenario into the demo dir.
- Browser-verified run `8a22c708...` (scenario `osm-sao-paulo-roads`, replay id `simedape-<run_id>`): OSM background, vehicles on curved roads, click -> "Detalhes do link" with street name, OSM way 4774379, reverse direction, HTC links of the same way, HTC attributes. `npm run typecheck -w web` passes.

## Not done / not verified

1. **Standalone regression not re-tested** after the road-geometry changes (`native-two-corridors-map`). Check replay + link click + both render paths (scatter layer and worker).
2. **Link line drawing**: only eyeballed from a screenshot that vehicles follow curves; confirm the link PathLayer follows the shape and nothing draws straight chords.
3. **Replay not auto-prepared**: opening `/simulator/replay?scenario=simedape-<run_id>` first shows HTTP 404 on `segments.arrow` until "Gerar replay" is clicked. Pre-existing; the results page link "Abrir replay deste run" may be the intended entry. Decide whether to auto-generate.
4. **Not a general importer**: no full-city OSM conversion, turn restrictions, junction topology, or real demand. Only the small fixed-route fixture.
5. **Live (bus/WebSocket) path** does not carry road geometry; only the replay path was done.
6. No automated tests added for `road_network.py`, `roadGeometry.ts` or the converter.
7. Do not describe OSM-backed mode as complete in docs or UI text.

## Run it

`bash scripts/run-native-integration-demo.sh` (web :3000, job API :5000, state in `/tmp/htc-native-demo-1000`).
Start a run: `POST localhost:5000/api/htc/runs {"scenario":"osm-sao-paulo-roads"}`, poll `GET /api/runs/<id>`, then open the replay URL above and click "Gerar replay".
