# Virtual sidewalks in HTC View

Live and replay show a nominal 1.8 m sidewalk on both sides of each road, outside the
carriageway with a 0.3 m gap. Road width continues to use the simulated lane count × 3.2 m.
The sidewalk layer follows road curves and appears at street-level zoom (16.5 and above).

Walking entities use these virtual paths in SVG, shape and binary-circle modes. A walking
row that references a road uses that road's offset geometry. For the older origin/destination
walking records, the viewer derives a shortest-distance pedestrian path across the road
network, allowing walking in both directions. Virtual connectors join sidewalk edges at
street corners. These paths are display geometry, not observed pedestrian trajectories.
Source events and reported departure/arrival ticks remain unchanged.

When the road network cannot connect the reported endpoints, the viewer retains a virtual
origin/destination corridor and draws it with lower opacity. No engine or replay regeneration
is needed for the sidewalk display. Tooltips identify pedestrians as using a virtual sidewalk.

Geometry is cached across live snapshots and discarded when it leaves the retained data.
Sidewalk bands are generated only around the camera; ordinary vehicle rows retain spatial
culling in the worker even when curved walking paths are present.

Validation: `npm run test:replay --workspace web` from `htc-ui`; `npm run typecheck --workspace web`;
`npm run build` from `htc-replay/web`. Browser evidence in `docs/validation/sidewalks-2026-11-02.json`
uses synthetic walking legs with the production geometry/render layers.

## Simulator Link configuration

New replay geometry carries each Link’s `sidewalk.enabled`, `sidewalk.width` and `sidewalk.gap`.
The viewer uses these instead of nominal defaults when present, and omits disabled sidewalk
bands. Regenerate older replay geometry to display custom settings. The simulator’s walking
graph also honors enabled/disabled access; see `hyperbolic-time-chamber/docs/SIDEWALKS.md`.
