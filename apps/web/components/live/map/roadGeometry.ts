import type { LinksTable, RoadNetwork, RoadPath } from "../types/replay"

export interface IndexedRoad {
  road: RoadPath
  cumulative: Float64Array
}

export interface PackedRoads {
  pathIndex: Int32Array
  offsets: Uint32Array
  coordinates: Float64Array
  cumulative: Float64Array
}

export function distanceMetres(
  a: readonly number[],
  b: readonly number[]
): number {
  const rad = Math.PI / 180
  const dlat = (b[1]! - a[1]!) * rad
  const dlon = (b[0]! - a[0]!) * rad
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(a[1]! * rad) * Math.cos(b[1]! * rad) * Math.sin(dlon / 2) ** 2
  return 6371008.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function indexRoad(road: RoadPath): IndexedRoad {
  const cumulative = new Float64Array(road.coordinates.length)
  for (let i = 1; i < cumulative.length; i++)
    cumulative[i] =
      cumulative[i - 1]! +
      distanceMetres(road.coordinates[i - 1]!, road.coordinates[i]!)
  const length = cumulative[cumulative.length - 1]!
  if (!(length > 0)) throw new Error("Road geometry has zero length")
  for (let i = 1; i < cumulative.length; i++)
    cumulative[i] = cumulative[i]! / length
  return { road, cumulative }
}

function interval(
  cumulative: Float64Array,
  start: number,
  end: number,
  fraction: number
): [number, number] {
  const f = Math.max(0, Math.min(1, fraction))
  let lo = start,
    hi = end - 1
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1
    if (cumulative[mid]! <= f) lo = mid
    else hi = mid
  }
  const span = cumulative[hi]! - cumulative[lo]!
  return [lo, span > 0 ? (f - cumulative[lo]!) / span : 0]
}

export function positionOnRoad(
  path: IndexedRoad,
  fraction: number
): [number, number] {
  const [index, t] = interval(
    path.cumulative,
    0,
    path.cumulative.length,
    fraction
  )
  const a = path.road.coordinates[index]!,
    b = path.road.coordinates[index + 1]!
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

/** Tangent of the actual polyline at this fraction, including bends and reversed OSM ways. */
export function directionOnRoad(path: IndexedRoad, fraction: number): number {
  const [index] = interval(path.cumulative, 0, path.cumulative.length, fraction)
  const a = path.road.coordinates[index]!,
    b = path.road.coordinates[index + 1]!
  const east = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) * Math.PI) / 360)
  return (-Math.atan2(east, b[1] - a[1]) * 180) / Math.PI
}

export function roadLookup(links: LinksTable): Map<string, IndexedRoad> {
  const paths = new Map<string, IndexedRoad>()
  if (!links.roadNetwork) return paths
  for (const id of links.linkId)
    paths.set(id, indexRoad(links.roadNetwork.links[id]!))
  return paths
}

export function validateRoadNetwork(
  data: RoadNetwork,
  links: LinksTable
): RoadNetwork {
  if (
    data.schema !== "htc.road-network.v1" ||
    data.mode !== "osm" ||
    data.source?.kind !== "openstreetmap"
  )
    throw new Error("Invalid OSM road-network contract")
  if (Object.keys(data.links).length !== links.length)
    throw new Error("OSM road mapping does not cover the executed HTC network")
  links.linkId.forEach((id, i) => {
    const road = data.links[id]
    if (
      !road ||
      typeof road.osmWayId !== "string" ||
      !road.osmWayId ||
      !["forward", "backward"].includes(road.direction) ||
      road.coordinates.length < 2 ||
      road.osmNodeIds.length !== road.coordinates.length
    )
      throw new Error(`Missing OSM identity or geometry for HTC link ${id}`)
    for (const point of road.coordinates)
      if (
        point.length !== 2 ||
        !point.every(Number.isFinite) ||
        Math.abs(point[0]) > 180 ||
        Math.abs(point[1]) > 85.05112878
      )
        throw new Error(`Invalid OSM road coordinates: ${id}`)
    if (
      distanceMetres(road.coordinates[0]!, [links.lon0[i]!, links.lat0[i]!]) >
        2 ||
      distanceMetres(road.coordinates.at(-1)!, [
        links.lon1[i]!,
        links.lat1[i]!,
      ]) > 2
    )
      throw new Error(
        `OSM road direction/endpoints do not match HTC link ${id}`
      )
    indexRoad(road)
  })
  return data
}

export function packRoads(
  paths: Map<string, IndexedRoad>,
  linkIds: string[]
): PackedRoads {
  const ordered = [...paths.entries()]
  const indices = new Map(ordered.map(([id], index) => [id, index]))
  const offsets = new Uint32Array(ordered.length + 1)
  for (let i = 0; i < ordered.length; i++)
    offsets[i + 1] = offsets[i]! + ordered[i]![1].cumulative.length
  const coordinates = new Float64Array(offsets.at(-1)! * 2)
  const cumulative = new Float64Array(offsets.at(-1)!)
  ordered.forEach(([, indexed], i) => {
    const offset = offsets[i]!
    indexed.road.coordinates.forEach((point, j) => {
      coordinates[(offset + j) * 2] = point[0]
      coordinates[(offset + j) * 2 + 1] = point[1]
    })
    cumulative.set(indexed.cumulative, offset)
  })
  return {
    offsets,
    coordinates,
    cumulative,
    pathIndex: Int32Array.from(linkIds, (id) => indices.get(id) ?? -1),
  }
}

export function positionOnPackedRoad(
  paths: PackedRoads,
  segmentIndex: number,
  fraction: number
): [number, number] | null {
  const pathIndex = paths.pathIndex[segmentIndex]!
  if (pathIndex < 0) return null
  const [index, t] = interval(
    paths.cumulative,
    paths.offsets[pathIndex]!,
    paths.offsets[pathIndex + 1]!,
    fraction
  )
  const x = index * 2
  return [
    paths.coordinates[x]! +
      (paths.coordinates[x + 2]! - paths.coordinates[x]!) * t,
    paths.coordinates[x + 1]! +
      (paths.coordinates[x + 3]! - paths.coordinates[x + 1]!) * t,
  ]
}

export function directionOnPackedRoad(
  paths: PackedRoads,
  segmentIndex: number,
  fraction: number
): number | null {
  const pathIndex = paths.pathIndex[segmentIndex]!
  if (pathIndex < 0) return null
  const [index] = interval(
    paths.cumulative,
    paths.offsets[pathIndex]!,
    paths.offsets[pathIndex + 1]!,
    fraction
  )
  const x = index * 2
  const east =
    (paths.coordinates[x + 2]! - paths.coordinates[x]!) *
    Math.cos(
      ((paths.coordinates[x + 1]! + paths.coordinates[x + 3]!) * Math.PI) / 360
    )
  return (
    (-Math.atan2(east, paths.coordinates[x + 3]! - paths.coordinates[x + 1]!) *
      180) /
    Math.PI
  )
}
