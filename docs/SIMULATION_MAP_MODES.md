# Simulation map modes and OSM compatibility

User requirements recorded on 2026-11-01. This supersedes the earlier suggestion that
adding an OSM background completes OSM integration.

Implementation update: a **bounded OSM-backed proof** now preserves real road identities,
full curves, vehicle interpolation and joined link/way metadata. The independent-network
regression also passes. See [implemented scope and evidence](OSM_COMPATIBILITY_VALIDATION.md).
The original requirements below remain the target for general compatibility; descriptions
of straight-only rendering and missing OSM metadata document the starting gap, now addressed
for this bounded profile. General city import and remaining acceptance are not claimed complete.

## Component responsibilities

- **HTC Platform** is the overall platform.
- **HTC** is the simulation engine. It executes vehicles, links, nodes and other actors.
- **HTC View** is a component of HTC Platform for control, visualization and scenario editing.
  Its current source directory is named `htc-ui`.
- **SimEDaPE** is the smart-city simulation acceleration technique. Running full HTC and
  displaying its output does not mean SimEDaPE acceleration was used.
- Bus/WebSocket and replay ETL are supporting integration/visualization paths. They should
  not be described as the SimEDaPE technique.

The generic run-management API is currently hosted in the `simedape` repository. Full-run
controls now live under **Execuções HTC** (`/simulator/runs`); existing endpoints and
environment names remain in use. Those implementation locations do not define the technique's role.

Map mode is independent of acceleration: a standalone or OSM-backed scenario can be
executed by HTC. SimEDaPE acceleration is a separate execution/analysis choice when supported.

**Simulation level is also independent of map mode.** HTC supports MICRO and MESO links,
including mixed networks. [Managed live runs](MANAGED_LIVE_RUNS.md) now execute and visualize
all three within the bounded fixed-route car profile. MESO travel interpolation and
traversal-average speed must not be presented as microscopic trajectory/acceleration/gap data.

## Two required simulation map modes

| Requirement | Standalone network | OSM-backed network |
|---|---|---|
| Network source | Synthetic, manually drawn or imported independently of OSM. | OSM road data, converted into a simulation network with recorded assumptions. |
| OSM correspondence | Not required. | Required for every simulated road claimed to represent an OSM street. |
| Geometry | Scenario-defined geometry. | Preserve the corresponding road shape and direction, including curved geometry. |
| Identifiers | Stable HTC node/link identifiers. | Stable HTC identifiers plus traceable OSM source node/way IDs and directed-segment mapping. |
| Vehicle movement | Follows HTC links/routes. | Follows HTC links/routes that correspond to the mapped OSM roads; visualization follows their road shapes. |
| Selection | Click a simulated link for its scenario information. | Click an imported street/road feature or HTC link, resolve its mapping and show both OSM and simulation information. |
| Background | Independent canvas; no OSM dependency. | OSM map/context behind the matching simulated network. |
| Missing OSM match | Not applicable. | Mark unsupported, unresolved or explicitly synthetic; do not report the road as OSM-compatible. |

This is the required product behavior. The current implementation does not yet satisfy
the entire OSM-backed column.

### Current implementation versus requirement

The verified corridor fixture is **standalone and synthetic**. Its display coordinates
were geographically anchored near Paris, but its links are not actual Paris OSM streets.
Displaying that fixture over OSM cannot establish street correspondence.

The shared renderer now supports a separate visual background setting:

```bash
# Independent background; current default for the standalone demo
NEXT_PUBLIC_HTC_MAP_BACKGROUND=none

# OSM background, for viewing geographically referenced data
NEXT_PUBLIC_HTC_MAP_BACKGROUND=osm
```

Restart/rebuild Next.js after changing browser configuration. `none` uses an empty style
with a background colour and no tile sources. The current MapLibre-based renderer still
expects geographic display coordinates in either background setting; a true local Cartesian
projection/canvas is a separate extension. `osm` uses the configured OSM raster/style source
and attribution. **This is a background switch, not validation of the OSM-backed simulation mode.**

Current native/replay execution and its geographic-coordinate checks remain documented in
the [integration runbook](../../simedape/docs/NATIVE_VIEW_INTEGRATION.md). There is no claim
that the fixture passes OSM road-compatibility acceptance.

## Are HTC links identical to OSM streets?

Not automatically, and not in the current synthetic demo. A single OSM way may produce
multiple directed HTC links after segmentation and direction handling. Two-way roads often
have separate directional links. The required relationship is an explicit source mapping,
not equality between the HTC link ID and an OSM way ID.

For OSM-backed scenarios, retain at least the source way ID, source node sequence, direction,
segment identity, source snapshot/date and the full display polyline. Preserve source tags
and record conversion/default decisions. Existing generators contain OSM parsing and ID
registries, but the replay `LinksTable`/`LinkPanel` currently do not expose this complete
road-source/shape contract.

## Do vehicles travel along the links?

Yes: HTC executes vehicles on links according to their routes, and reports link identity.
The current verified replay builds traversal segments from those reports. HTC View then
interpolates positions along each displayed link between its endpoints. It does not invent
free movement across the background map, but its present endpoint representation draws
straight chords rather than full curved OSM roads. Replay interpolation is also distinct
from exporting every microscopic integration step.

Relevant implementation:

- [Replay segment building](../../htc-replay/etl/src/main/scala/htcreplay/transform/BuildFrames.scala).
- [Straight endpoint geometry](../../htc-replay/etl/src/main/scala/htcreplay/transform/GeometryOps.scala).
- [Vehicle position interpolation](../apps/web/components/live/map/layers/vehicleScatterLayer.ts).
- [Shared map and selection handling](../apps/web/components/live/map/MapView.tsx).

OSM compatibility requires retaining and using the road polyline for road rendering,
vehicle-position interpolation and picking across both ordinary and worker/binary rendering
paths. Adding a basemap or merely moving endpoints near an OSM street is insufficient.

## What can be clicked today?

**An HTC overlay link is selectable.** Hovering shows its tooltip; clicking opens
[LinkPanel](../apps/web/components/live/map/LinkPanel.tsx), which currently shows:

- HTC link ID and simulation mode.
- Length in metres, lane count and free-flow speed in km/h.
- Source and target coordinates.

This is implemented in code; interactive browser acceptance remains pending. The panel does
not currently show OSM way ID/street name or time-dependent link measurements.

**An arbitrary street painted in the OSM raster background is not a selectable road object.**
It is part of a tile image. To satisfy the requested interaction, load selectable road
geometry and its source properties, map that selection to HTC link(s), and show an explicit
“outside simulated network” state for streets that were not imported. A street can map to
several directional/segmented links; the UI must let the user distinguish them.

The required inspector should include OSM street name/way ID/source tags, corresponding HTC
link IDs and direction, model parameters and selected-time simulation measurements where
available. Display unavailable measurements as missing. Do not represent an unobserved value
as zero or attribute one direction's measurements to the whole street without aggregation rules.

## Revised implementation priority

1. Keep the standalone demo explicitly standalone. Preserve correct component terminology.
2. Define and export an OSM source-to-HTC-link mapping plus full road geometry for one
   bounded, genuinely OSM-derived scenario. Keep this in its immutable run snapshot.
3. Extend replay/live geometry artifacts and every vehicle rendering path to follow those
   polylines while preserving HTC physical link length and simulation time semantics.
4. Extend picking and the inspector to join OSM road information to HTC links and available
   run measurements. Show streets outside the simulated network without inventing a link match.
5. Validate the OSM-backed mode end to end before labelling it compatible. Then build the
   [editor workflow](MAP_EDITOR_SPEC.md) around these two modes and canonical data contracts.

Acceptance must include a curved road, a two-way road split into directional links, an OSM
way split across several HTC links, a grade-separated crossing, vehicle motion along the
correct road, clickable road/link information, and unchanged standalone behavior. Use a
fixed OSM source snapshot and a real HTC run. Geographic bounds and successful builds alone
do not establish OSM compatibility.

See also: `OSM_BACKED_HANDOFF.md` (current status and open items).
