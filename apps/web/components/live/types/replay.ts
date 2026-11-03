export interface BoundingBox {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

export interface Manifest {
  mapMode?: "standalone" | "osm";
  scenarioId: string;
  tickMin: number;
  tickMax: number;
  ticksPerSecond: number;
  vehicleCount: number;
  hasEmissions: boolean;
  hasSignals: boolean;
  hasStops: boolean;
  hasRailLinks: boolean;
  boundingBox: BoundingBox | null;
  files: { links: string; segments: string; nodes: string; signals: string; stops: string; railLinks: string };
}

export interface RoadPath {
  osmWayId: string;
  osmNodeIds: string[];
  name: string;
  direction: "forward" | "backward";
  tags: Record<string, string>;
  coordinates: [number, number][];
}

export interface RoadNetwork {
  schema: "htc.road-network.v1";
  mode: "osm";
  source: { kind: "openstreetmap"; sha256: string; name: string; license: string };
  links: Record<string, RoadPath>;
}

/** Columnar view over `segments.arrow` — one entry per index across all arrays. */
export interface SegmentsTable {
  /** Optional for older artifacts; NaN means the simulation did not report a lane. */
  startLane?: Float32Array;
  endLane?: Float32Array;
  length: number;
  vehicleId: string[];
  vehicleKind: string[];
  linkId: string[];
  startTick: Float64Array;
  endTick: Float64Array;
  lat0: Float32Array;
  lon0: Float32Array;
  lat1: Float32Array;
  lon1: Float32Array;
  startFrac: Float32Array;
  endFrac: Float32Array;
  speedKmh: Float32Array;
  co2Grams: Float32Array;
  noxGrams: Float32Array;
  pm25Grams: Float32Array;
}

/** Columnar view over `links.arrow` — the static road network base layer. */
export interface LinksTable {
  sidewalkEnabled?: Int32Array;
  sidewalkWidthM?: Float32Array;
  sidewalkGapM?: Float32Array;
  roadNetwork?: RoadNetwork;
  length: number;
  linkId: string[];
  lat0: Float32Array;
  lon0: Float32Array;
  lat1: Float32Array;
  lon1: Float32Array;
  lengthM: Float32Array;
  lanes: Int32Array;
  simulationMode: string[];
  freeSpeedKmh: Float32Array;
}

/** Columnar view over `nodes.arrow` — every scenario node (not just link endpoints a
 * vehicle happens to visit), the click/hover target for intersection-level info. */
export interface NodesTable {
  length: number;
  nodeId: string[];
  lat: Float32Array;
  lon: Float32Array;
  hasSignal: Int32Array;
}

/** One traffic-light phase: `origin` is the link id given right-of-way (green) during the
 * [greenStartTick, greenStartTick+greenDurationTick) window of the signal's cycle. Mirrors
 * `model.hybrid.entity.state.model.Phase` in the simulator exactly.
 */
export interface TrafficSignalPhase {
  origin: string;
  greenStartTick: number;
  greenDurationTick: number;
}

/** Mirrors `model.hybrid.entity.state.TrafficSignalState`. Loaded from `signals.json` — a
 * plain JSON array, not Arrow, since signal counts are orders of magnitude smaller than
 * links/vehicles and will never need a binary/columnar treatment.
 */
export interface TrafficSignalConfig {
  signalId: string;
  nodeIds: string[];
  startTick: number;
  cycleDuration: number;
  offset: number;
  phases: TrafficSignalPhase[];
}

export type StopKind = "BusStop" | "BusStation" | "SubwayStation";

/** Mirrors `model.hybrid.entity.state.{BusStopState,BusStationState,SubwayStationState}` in the
 * simulator, reduced to a single marker point. Loaded from `stops.json` — a plain JSON array,
 * same rationale as `TrafficSignalConfig`. `lat`/`lon` are already resolved from the source
 * node id by the ETL, so the frontend needs no nodeId lookup for this.
 */
export interface StopConfig {
  stopId: string;
  kind: StopKind;
  label: string;
  lat: number;
  lon: number;
}

/** Columnar view over `rail_links.arrow` — the separate, exclusive rail network (subway/
 * light-rail/heavy-rail), kept apart from `LinksTable` since road vehicles never use it and
 * every existing links consumer would otherwise need to filter it out. `subwayLine` is `""`
 * for non-subway rail types (Arrow has no per-row-nullable string handling wired up here).
 */
export interface RailLinksTable {
  length: number;
  linkId: string[];
  lat0: Float32Array;
  lon0: Float32Array;
  lat1: Float32Array;
  lon1: Float32Array;
  lengthM: Float32Array;
  lanes: Int32Array;
  freeSpeedKmh: Float32Array;
  railType: string[];
  subwayLine: string[];
}
