# Bounded OSM compatibility — implementation and verification

Recorded 2026-11-01. This is an engineering integration check, not an accuracy study or
approval of a general OSM importer. HTC is the engine, HTC View is the platform component,
and SimEDaPE acceleration is not exercised by these full runs.

The later [bounded import workflow](../../tools/osm_scenario/IMPORT_WORKFLOW.md) extends
the two-way fixture below to reusable area selection, preview and atomic publication.
Its regional-file selection produced 11 ways, 34 directed links and 17 simulation nodes.
Real HTC run `089d73f5d13d456485c939bb14093dee` and replay/map audits passed; see its
[separate evidence](../../tools/osm_scenario/validation/neighbourhood-2026-11-01.json).
The [import screen/endpoints](OSM_IMPORT_WORKFLOW.md) are now implemented and exercised
through their actual client and real HTC runs. Fresh browser acceptance, shared API reload
and broader OSM rule support remain open.

## Implemented path

The [bounded converter](../../tools/osm_scenario/README.md) imports two real São Paulo OSM
ways into six directed HTC MICRO links. Junctions use shared source nodes; complete road
polylines and their OSM node order are retained. Each executed link has a source way ID,
street name, direction and original tags. The source XML is saved with a fingerprint.

The native adapter validates the mapping against the actual OSM extract and HTC endpoints,
then copies both source and mapping into the executed scenario snapshot. Their fingerprints
participate in input lineage. The replay bridge transfers the geometry over HTTP, verifies
its hash and publishes it with the run-bound manifest. Editing the catalogue cannot silently
replace the completed run's geometry. The replay bounds include interior curve vertices,
which may extend well beyond the simulation junction endpoints.

HTC View loads the mapping alongside Arrow tables. OSM links use a pickable `PathLayer`;
standalone links retain their existing binary `LineLayer`. Both the ordinary vehicle path
and the circle/worker path use the same arc-length-indexed polyline kernel. The OSM worker
culls actual positions rather than the old endpoint-midpoint approximation, which could
exclude a bend visible in the viewport. This first bounded path scans candidate segments;
city-scale indexing/performance has not been demonstrated.

Clicking an imported road/link opens its HTC attributes plus the OSM street name, way ID,
direction, tags and an external way link. The panel can select sibling HTC links belonging
to the same way, including other directions and split segments. This does not make arbitrary
streets painted in raster tiles selectable. Only imported simulated road features have this
joined inspector; background streets outside the imported network remain outside this proof.

## Verified runs

| Check | OSM-backed bounded fixture | Standalone regression |
|---|---|---|
| Run | `bcebd1d85d41419ba54cff5f8ae8a330` | `815621b601c14af19b3fa0bc22dc5737` |
| Scenario | `default:osm-sao-paulo-roads` | `default:native-two-corridors-map` |
| Actual departed vehicles | 16 | 16 |
| HTC links / nodes | 6 / 4 | 4 / 5 |
| Replay traversal segments | 24 | 32 |
| Measured HTTP values checked | 6,480 | 864 |
| Missing values preserved | 3,970 | 361 |
| Road layer payload | Curved `PathLayer` | Original `LineLayer` |
| OSM source identity | Ways 4774379 and 4774398 | No OSM mapping |

For the real OSM output, 504 sampled positions agreed between ordinary and packed-worker
geometry kernels. Source vertices also map back to their expected polyline positions.
The maximum road/chord separation is about **255 m**, so this fixture detects replacing
curves with straight endpoint segments. Shape hashes, full-shape bounds and picking metadata
passed. Kernel/layer checks are not a substitute for WebGL/browser acceptance.

Raw downloaded evidence:

- OSM HTTP/dataset/replay: `/tmp/htc-osm-final-check-20261101`.
- OSM geometry audit: `/tmp/htc-osm-final-check-20261101/map-geometry-check.json`.
- Standalone HTTP/replay/geometry: `/tmp/htc-standalone-osm-regression-20261101`.
- Repository [compact evidence](validation/osm-map-2026-11-01.json).

Automated checks cover source forgery, direction/endpoints, missing mappings, immutable
snapshots, reverse/one-way roads, mph conversion, package export, 64-bit source IDs,
normal/worker interpolation, curved pickable layer payload, standalone fallback and bounds
that include interior vertices. The Python suite discovered 234 tests: 230 passed and four
opt-in checks skipped. The converter adds three passing tests. The Node replay/map suite
contains ten tests after the full-shape-bounds regression was added.

## Reproduce

The shared launcher creates the standalone and OSM fixtures. Preserve any stack already
running; coordinate service restarts through [the agent alignment](../../AGENT_COORDINATION.md).

```bash
SIMEDAPE_PYTHON=/path/to/venv/bin/python scripts/run-native-integration-demo.sh
```

Open `/simulator/runs`, select the OSM scenario, execute HTC and open that run's replay.
The API catalogue may qualify names with a location prefix; use the returned name.

```bash
python scripts/check-native-integration.py --scenario default:osm-sao-paulo-roads \
  --replay --output /tmp/new-osm-check
```

To audit a completed run instead of starting another JVM, add `--run-id <id>` and choose
a new output directory. The script follows the current `/simulator/runs` page, not the old
full-run controls formerly placed under `/simedape`.

Run the geometry audit from `htc-ui/apps/web`:

```bash
node --experimental-strip-types scripts/check-map-geometry.mjs \
  /tmp/new-osm-check/replay /tmp/new-osm-check/map-geometry-check.json
```

## Remaining acceptance and limits

The shared [handoff](OSM_BACKED_HANDOFF.md) records an earlier browser check on run
`8a22c708...` with curved-road motion and the OSM inspector. Codex's own browser tool exposes
no browser, so the final combined acceptance was requested from Claude in the alignment file:
OSM and standalone, emoji and circle/worker representations, road selection and sibling
direction selection. Do not describe these scripted checks as a fresh browser test.

This supports bounded segmented-road scenarios, not arbitrary OSM networks or
realistic traffic demand. The bounded CLI and UI importer are available; browser acceptance, restriction relations, grade-separated-network
acceptance, curved-road city-scale performance, road inspection outside the imported network,
live stream integration, local Cartesian rendering and editor implementation remain open.
OSM raster tiles remain subject to their provider's interactive-use and attribution requirements.
