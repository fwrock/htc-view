# HTC View: bounded OSM import

Implemented 2026-11-01. HTC View prepares and publishes scenarios; HTC executes them.
This workflow does not exercise SimEDaPE acceleration or optimize traffic accuracy.

## Use the screen

Open **Preparar cenário** in the sidebar (`/simulator/import`). It is also linked from
**Simulator → Execuções → Preparar cenário: HTC ou OSM**.
The starting screen separates four paths:

- **Existing HTC scenario**: use the complete native scenario folder directly.
- **OSM conversion**: create a new native HTC JSON scenario from roads and synthetic test cars.
- **EQASim/MATSim population**: explains the existing offline converters and engine path;
  a web population-conversion wizard is still pending.
- **A map JSON alone / combining networks**: explains missing scenario inputs and the
  unimplemented association of an existing HTC network with OSM.

For the OSM path choose **Converter OSM para HTC** (`?flow=osm`). It creates files on
the API machine in a chosen folder; it is not a browser download or a merge of existing maps.

1. Select a registered source folder, or use **Escolher outra pasta no servidor** to browse
   and register it inline. Select/register the destination separately when saving. The picker
   reuses an already registered input folder at the same path; newly chosen local folders
   are saved in **Locais** for later use. Local folders and Docker host bind mounts are
   supported; SSH/GCS import publication is not implemented.
2. Choose the source location, browse its folders and select an `.osm`, `.xml`, `.osm.gz`
   or `.xml.gz` file. Browser upload, PBF conversion and downloads from the OSM service
   are not part of this workflow.
3. Choose **Usar todas as ruas deste arquivo pequeno**, or **Selecionar uma área de um
   extrato maior** and **Usar área visível**. Manual coordinates are in a collapsed section.
   Whole ways that
   intersect the requested area are retained; their shapes may extend beyond the box.
4. The default test uses 16 synthetic cars and 900 seconds; optional count/duration/profile
   settings are in **Ajustar carros, duração e opções avançadas**. Choose **Analisar arquivo
   e ver rede** or **Analisar área e ver rede**.
   Large regional files run as background jobs. Their phase/count events appear under
   **Progresso da importação**. Keep the `?job=...` URL to recover a job after navigation
   or refresh; jobs also appear on the dashboard with links back to this screen.
5. Inspect the blue road shapes and diagnostics. Repeated messages are grouped with readable
   explanations and next actions; original messages/source IDs remain expandable. Click a preview road to see its name,
   OSM way identity, direction, length and model speed. Map attribution remains visible
   independently of raster availability. Source errors block publication; warnings make
   the bounded profile's assumptions explicit.
6. Choose the destination folder explicitly and a new scenario name, then **Salvar cenário
   HTC**. The screen shows the output path and generated contents before writing. Saving
   repeats preparation and requires the server-held preview hash.
   A changed source/configuration requires another preview. Existing revisions are preserved.
7. **Executar este cenário no HTC** opens `/simulator/runs?scenario=<location>:<revision>`
   with that supported scenario selected. Execute HTC and open the completed run's replay.

Changing the source, area or profile clears the reviewed preview. Publishing never starts
HTC automatically. The import page is a preparation workflow, not the full map editor.
See the [backend profile and limits](../../tools/osm_scenario/IMPORT_WORKFLOW.md).

## Population scenarios are a separate path

The [São Paulo converter](../../tools/sao-paulo/README.md) accepts EQASim tables or selected
MATSim plans, together with OSM roads and compatible coordinates. The
[Toulouse converter](../../tools/toulouse/README.md) uses its native MATSim network and
population inputs. Both generate HTC configuration, maps and actors; HTC does not ingest
the raw MATSim plans directly. A real road network plus a synthetic population is a valid
scenario composition; synthetic demand does not become observed traffic because its map is real.

Person/owned-vehicle/transit scenarios use the general engine workflow under **Simulador**.
The measured `/simulator/runs` adapter currently accepts independently scheduled fixed-route
cars on MICRO, MESO or mixed links and rejects population/transit actors. The bounded OSM
importer itself still creates its single-lane MICRO profile. See [managed live runs](MANAGED_LIVE_RUNS.md)
for streaming and level-specific measurements. The
[retained bounded hybrid smoke](../../tools/sao-paulo/VALIDATION.md) establishes a small
engine/converter path, not a full-city population run or validated population visualization.
Coordinate correspondence, geometry/event delivery into HTC View and end-to-end acceptance
for the chosen population scenario remain to be completed. The new population guide makes
these boundaries visible instead of routing users into the small OSM test-car form.

## API contract

These routes run in the existing Flask platform API. HTC View uses the same
`NEXT_PUBLIC_SIMEDAPE_API_URL` as the jobs and locations clients; that historical setting
does not classify this import workflow as the SimEDaPE technique.

| Request | Contract |
|---|---|
| `GET /api/htc/osm/sources?location=<id>&directory=<relative>` | One directory's XML/gzip files and subdirectories; no recursive regional scan. At most 500 entries, with a truncation flag. |
| `POST /api/htc/osm/preview` | `{source_location, source, options}`; returns `202 {run_id}`. `source` is relative to the registered location. |
| `POST /api/htc/osm/publish` | `{preview_run_id, target_location, revision}`; returns `202 {run_id}`. Options/source/hash come from the completed server-held preview. |
| `GET /api/runs/<run_id>` | Existing job status/logs and `result.osm_import`. A completed operation may have an `invalid` import report; inspect diagnostics. |

Preview options: `bbox` (four geographic degrees, or null), `max_ways` (1–100), `cars`
(1–1000), `duration` (after the final departure), `allow_disconnected` (boolean). See
`tools/osm_scenario/importer.py` for the shared validator. Invalid request types/options
return 400; missing previews return 404; an existing destination returns 409. A destination
created concurrently is also preserved by the importer's atomic no-replace promotion.

Only input/both locations of kind local/docker are used. The API resolves paths beneath
the registered root and rejects traversal, hidden components, absolute client paths and
symlinks escaping that root. It rechecks location mappings when queued jobs start and
rejects source-location changes after preview. Destination names cannot contain paths.
The deployment must control who can register locations, as with the existing locations API.

Jobs use `htc_osm_preview` / `htc_osm_publish`, so HTC View keeps them out of the SimEDaPE
experiment list. Each import executes in its own Python child process, isolating the legacy
actor exporter's mutable ID registry across concurrent publications. The platform checkout
must include `tools/osm_scenario` beside the API; the API Python environment needs its
conversion dependencies and `htc-locations` installed or on `PYTHONPATH`.

## Verification and running demo

An isolated review instance is available on **http://localhost:3001/simulator/import**,
with API **http://localhost:5003**. Its registry, jobs, outputs and replay live in
`/tmp/htc-osm-view-20261101`; the production-built View copy is under `view/`. Choose
**Fontes OSM de exemplo → sao-paulo-neighbourhood.osm** and publish into
**Cenários OSM importados** using a new revision name. The shared :3000/:5000 services
were not restarted, and their API still needs a coordinated reload to expose the new routes.
This temporary review instance does not replace the shared stack.

The 2026-11-01 UX revision was production-built and type checked. ESLint passed for the
changed import modules. Six HTTP-render checks cover the entry choices, existing HTC,
OSM conversion, population guidance, combination guidance and a previous job URL; see
[UX evidence](validation/scenario-input-ux-2026-11-01.json). The page now renders its
purpose and input choices on the server, and loads the map only after choosing an OSM file.
No backend or engine behavior was changed in that UX revision. These checks do not replace
browser interaction acceptance of the folder picker, map and save flow.

The screen's actual API client passed browse → preview → publish → catalogue → native start
against this isolated API. The resulting `osm-demo:osm-screen-v1` ran in HTC, and its
results/replay audit passed. A standalone scenario was run afterward as a regression.

| Evidence | OSM import | Standalone regression |
|---|---|---|
| HTC run | `bade65025d6d47dcab5420bc125a9af6` | `39659a188eba40e9a1af46431255d29f` |
| Departed cars | 16 | 16 |
| Links / nodes | 34 / 17 | 4 / 5 |
| Replay traversal segments | 30 | 32 |
| HTTP values checked | 36,720 | 864 |
| Missing entries preserved | 24,036 | 361 |
| Geometry / picking payload | PathLayer, 630 normal/worker comparisons | LineLayer, no OSM mapping |

Seven new import HTTP tests passed, alongside nineteen native/general API tests (**26 total**).
The native test fixture now isolates the locations registry and accepts location-qualified
catalogue names. The production Next build/type checking passed; the new page, map, client
and client-check script passed ESLint. [Compact evidence](validation/osm-import-view-2026-11-01.json)
retains the run identities and hashes. Full artifacts are in
`/tmp/htc-osm-screen-check-20261101`.

These checks verify API/client integration, compiled routes, engine results, replay and map
kernels. **Fresh browser/WebGL acceptance remains pending**: the computer-use tool exposed
no browser. In particular, actual map interaction, reload recovery, carried scenario
selection and normal/worker visual movement need a browser pass. This has been requested
from Claude in [the coordination file](../../AGENT_COORDINATION.md).

## Reproduce checks

From `simedape/`, using the platform Python environment and installed `htc-locations`:

```bash
PYTHONPATH=../htc-locations python -m unittest \
  tests.test_osm_import_api tests.test_native_api tests.test_api -v
```

From `htc-ui/apps/web`, against a running API with suitable registered locations:

```bash
NEXT_PUBLIC_SIMEDAPE_API_URL=http://127.0.0.1:5003 \
node --experimental-strip-types scripts/check-osm-import.mjs \
  --source-location osm-source --source sao-paulo-neighbourhood.osm \
  --target-location osm-demo --revision osm-screen-v2 \
  --output /tmp/new-osm-import-check --run
```

`--run` starts a real HTC execution; omit it to stop after publication/catalogue validation.
Use the returned run ID with `scripts/check-native-integration.py --run-id` to audit results
and replay without launching another engine. Select a new output directory each time.

Next acceptance: perform the browser pass in both map modes, then coordinate the shared
API reload. Accuracy work remains after functional integration. Full-city import, arbitrary
turn restrictions, observed demand, live streaming and a general map editor remain separate gaps.
