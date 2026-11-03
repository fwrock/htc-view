import { Table, tableFromIPC } from "apache-arrow"
import type {
  LinksTable,
  NodesTable,
  RailLinksTable,
  SegmentsTable,
  StopConfig,
  TrafficSignalConfig,
} from "../types/replay"
import type { ScenarioSource } from "./scenarioSource"
import { validateRoadNetwork } from "../map/roadGeometry"

async function fetchArrowTable(
  source: ScenarioSource,
  fileName: string
): Promise<Table> {
  const buf = await source.fetchBinary(fileName)
  return tableFromIPC(new Uint8Array(buf))
}

function utf8Column(table: Table, name: string): string[] {
  // `.toArray()` on a Utf8Vector already materializes a plain `string[]` — no need to wrap
  // it in `Array.from(...).map(String)`, which was two entirely redundant full-array passes.
  // The remaining cost (still significant at 1M+ rows) is the UTF-8 decode into individual
  // JS string objects itself, which dictionary encoding would mostly eliminate for repeated
  // values (e.g. link_id) — see docs/KNOWN_GAPS.md.
  return table.getChild(name)!.toArray() as string[]
}

function float32Column(table: Table, name: string): Float32Array {
  return Float32Array.from(table.getChild(name)!.toArray())
}

function int32Column(table: Table, name: string): Int32Array {
  return Int32Array.from(table.getChild(name)!.toArray())
}

// start_tick/end_tick are 64-bit ints in the Arrow schema, decoded as BigInt64Array by
// apache-arrow; converted to Float64Array here since ticks comfortably fit a JS double
// (simulations run for at most tens of millions of ticks) and downstream math is float-based.
function bigIntTickColumn(table: Table, name: string): Float64Array {
  return Float64Array.from(table.getChild(name)!.toArray(), (v) => Number(v))
}

export async function loadSegments(
  source: ScenarioSource
): Promise<SegmentsTable> {
  const table = await fetchArrowTable(source, "segments.arrow")
  return {
    length: table.numRows,
    vehicleId: utf8Column(table, "vehicle_id"),
    startLane: table.getChild("start_lane")
      ? Float32Array.from(table.getChild("start_lane")!, (v) =>
          v == null ? NaN : Number(v)
        )
      : undefined,
    endLane: table.getChild("end_lane")
      ? Float32Array.from(table.getChild("end_lane")!, (v) =>
          v == null ? NaN : Number(v)
        )
      : undefined,
    vehicleKind: utf8Column(table, "vehicle_kind"),
    linkId: utf8Column(table, "link_id"),
    startTick: bigIntTickColumn(table, "start_tick"),
    endTick: bigIntTickColumn(table, "end_tick"),
    lat0: float32Column(table, "lat0"),
    lon0: float32Column(table, "lon0"),
    lat1: float32Column(table, "lat1"),
    lon1: float32Column(table, "lon1"),
    startFrac: float32Column(table, "start_frac"),
    endFrac: float32Column(table, "end_frac"),
    speedKmh: float32Column(table, "speed_kmh"),
    co2Grams: float32Column(table, "co2_grams"),
    noxGrams: float32Column(table, "nox_grams"),
    pm25Grams: float32Column(table, "pm25_grams"),
  }
}

export async function loadLinks(source: ScenarioSource): Promise<LinksTable> {
  const table = await fetchArrowTable(source, "links.arrow")
  const links: LinksTable = {
    length: table.numRows,
    sidewalkEnabled: table.getChild("sidewalk_enabled")
      ? int32Column(table, "sidewalk_enabled")
      : undefined,
    sidewalkWidthM: table.getChild("sidewalk_width_m")
      ? float32Column(table, "sidewalk_width_m")
      : undefined,
    sidewalkGapM: table.getChild("sidewalk_gap_m")
      ? float32Column(table, "sidewalk_gap_m")
      : undefined,
    linkId: utf8Column(table, "link_id"),
    lat0: float32Column(table, "lat0"),
    lon0: float32Column(table, "lon0"),
    lat1: float32Column(table, "lat1"),
    lon1: float32Column(table, "lon1"),
    lengthM: float32Column(table, "length_m"),
    lanes: int32Column(table, "lanes"),
    simulationMode: utf8Column(table, "simulation_mode"),
    freeSpeedKmh: float32Column(table, "free_speed_kmh"),
  }
  const [roadText, manifestText] = await Promise.all([
    source.fetchText("road_network.json"),
    source.fetchText("manifest.json"),
  ])
  if (roadText)
    links.roadNetwork = validateRoadNetwork(JSON.parse(roadText), links)
  else if (manifestText && JSON.parse(manifestText).mapMode === "osm")
    throw new Error("OSM replay is missing its required road geometry")
  return links
}

/** Builds a `link_id -> freeSpeedKmh` lookup so vehicle positions (keyed by link_id, no
 * freeSpeed of their own) can be colored relative to the road they're on. */
export function buildFreeSpeedLookup(links: LinksTable): Map<string, number> {
  const lookup = new Map<string, number>()
  for (let i = 0; i < links.length; i++) {
    lookup.set(links.linkId[i]!, links.freeSpeedKmh[i]!)
  }
  return lookup
}

export async function loadNodes(source: ScenarioSource): Promise<NodesTable> {
  const table = await fetchArrowTable(source, "nodes.arrow")
  return {
    length: table.numRows,
    nodeId: utf8Column(table, "node_id"),
    lat: float32Column(table, "lat"),
    lon: float32Column(table, "lon"),
    hasSignal: int32Column(table, "has_signal"),
  }
}

/** `signals.json` is empty for the overwhelming majority of scenarios (every fixture used to
 * build this ETL has zero traffic signals) — a missing file or empty array are both the
 * normal case, not an error worth surfacing to the user.
 */
export async function loadSignals(
  source: ScenarioSource
): Promise<TrafficSignalConfig[]> {
  try {
    const text = await source.fetchText("signals.json")
    if (text === null) return []
    return JSON.parse(text) as TrafficSignalConfig[]
  } catch {
    return []
  }
}

/** `stops.json` — bus stops/stations and subway stations. Same "optional, empty is normal"
 * treatment as `loadSignals`.
 */
export async function loadStops(source: ScenarioSource): Promise<StopConfig[]> {
  try {
    const text = await source.fetchText("stops.json")
    if (text === null) return []
    return JSON.parse(text) as StopConfig[]
  } catch {
    return []
  }
}

export async function loadRailLinks(
  source: ScenarioSource
): Promise<RailLinksTable> {
  const table = await fetchArrowTable(source, "rail_links.arrow")
  return {
    length: table.numRows,
    linkId: utf8Column(table, "link_id"),
    lat0: float32Column(table, "lat0"),
    lon0: float32Column(table, "lon0"),
    lat1: float32Column(table, "lat1"),
    lon1: float32Column(table, "lon1"),
    lengthM: float32Column(table, "length_m"),
    lanes: int32Column(table, "lanes"),
    freeSpeedKmh: float32Column(table, "free_speed_kmh"),
    railType: utf8Column(table, "rail_type"),
    subwayLine: utf8Column(table, "subway_line"),
  }
}
