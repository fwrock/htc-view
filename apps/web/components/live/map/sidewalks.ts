import type { LinksTable, SegmentsTable } from "../types/replay"
import { LANE_WIDTH_M } from "./entityGeometry"
import { offsetPolyline, type LonLat } from "./laneGeometry"
import { distanceMetres, indexRoad, type IndexedRoad } from "./roadGeometry"

export const SIDEWALK_WIDTH_M = 1.8
export const SIDEWALK_GAP_M = 0.3
export const SIDEWALK_PREFIX = "sidewalk:"

export function linkSidewalk(links: LinksTable, i: number) {
  return {
    enabled: (links.sidewalkEnabled?.[i] ?? 1) !== 0,
    width: links.sidewalkWidthM?.[i] ?? SIDEWALK_WIDTH_M,
    gap: links.sidewalkGapM?.[i] ?? SIDEWALK_GAP_M,
  }
}

export function sidewalkOffset(
  lanes: number,
  width = SIDEWALK_WIDTH_M,
  gap = SIDEWALK_GAP_M
): number {
  return (Math.max(1, lanes) * LANE_WIDTH_M) / 2 + gap + width / 2
}

export function roadCoordinates(links: LinksTable, i: number): LonLat[] {
  return (
    links.roadNetwork?.links[links.linkId[i]!]?.coordinates ?? [
      [links.lon0[i]!, links.lat0[i]!],
      [links.lon1[i]!, links.lat1[i]!],
    ]
  )
}

type Edge = {
  to: string
  coordinates: LonLat[]
  offset: number
  distance: number
}
type Route = {
  coordinates: LonLat[]
  fallback: boolean
  blocked?: boolean
  connectors?: LonLat[][]
  indexed?: IndexedRoad
}
const pointKey = (p: readonly number[]) =>
  `${Math.fround(p[0]!)}:${Math.fround(p[1]!)}`

// A bounded Dijkstra search runs once per distinct walking leg, never once per animation frame.
class MinQueue {
  private values: [number, string][] = []
  push(value: [number, string]) {
    let i = this.values.length
    this.values.push(value)
    while (i > 0) {
      const parent = (i - 1) >>> 1
      if (this.values[parent]![0] <= value[0]) break
      this.values[i] = this.values[parent]!
      i = parent
    }
    this.values[i] = value
  }
  pop(): [number, string] | undefined {
    const first = this.values[0],
      last = this.values.pop()
    if (this.values.length && last) {
      let i = 0
      while (i * 2 + 1 < this.values.length) {
        let child = i * 2 + 1
        if (
          child + 1 < this.values.length &&
          this.values[child + 1]![0] < this.values[child]![0]
        )
          child++
        if (this.values[child]![0] >= last[0]) break
        this.values[i] = this.values[child]!
        i = child
      }
      this.values[i] = last
    }
    return first
  }
}

/** A display-only, bidirectional pedestrian network; vehicle one-way lanes are unchanged. */
export class SidewalkNetwork {
  private graph: Map<string, Edge[]> | null = null
  private linkIndex: Map<string, number> | null = null
  private cache = new Map<string, Route>()
  private used = new Set<string>()
  private links: LinksTable
  constructor(links: LinksTable) {
    this.links = links
  }

  beginScene() {
    this.used.clear()
  }
  endScene() {
    // The live store already bounds its trailing window; retain only routes referenced by it.
    for (const key of this.cache.keys())
      if (!this.used.has(key)) this.cache.delete(key)
  }

  private initialize() {
    if (this.graph) return
    this.graph = new Map()
    this.linkIndex = new Map()
    for (let i = 0; i < this.links.length; i++) {
      this.linkIndex.set(this.links.linkId[i]!, i)
      if (!linkSidewalk(this.links, i).enabled) continue
      const coordinates = roadCoordinates(this.links, i)
      if (coordinates.length < 2) continue
      const from = pointKey(coordinates[0]!),
        to = pointKey(coordinates.at(-1)!)
      if (from === to) continue
      const distance =
        this.links.lengthM[i]! > 0
          ? this.links.lengthM[i]!
          : distanceMetres(coordinates[0]!, coordinates.at(-1)!)
      if (!(distance > 0) || !Number.isFinite(distance)) continue
      const lanes = Math.max(1, this.links.lanes[i]!)
      const sidewalk = linkSidewalk(this.links, i)
      const offset = sidewalkOffset(lanes, sidewalk.width, sidewalk.gap)
      const forward = this.graph.get(from) ?? [],
        backward = this.graph.get(to) ?? []
      forward.push({ to, coordinates, offset, distance })
      backward.push({
        to: from,
        coordinates: [...coordinates].reverse(),
        offset,
        distance,
      })
      this.graph.set(from, forward)
      this.graph.set(to, backward)
      this.linkIndex.set(this.links.linkId[i]!, i)
    }
  }

  route(linkId: string, from: LonLat, to: LonLat, reverse: boolean): Route {
    const cacheKey = `${linkId}:${pointKey(from)}:${pointKey(to)}:${reverse}`
    this.used.add(cacheKey)
    const cached = this.cache.get(cacheKey)
    if (cached) return cached
    this.initialize()
    const direct = this.linkIndex!.get(linkId)
    let result: Route | undefined
    if (direct !== undefined && !linkSidewalk(this.links, direct).enabled)
      return { coordinates: [from, to], fallback: false, blocked: true }
    if (direct !== undefined) {
      const sidewalk = linkSidewalk(this.links, direct)
      result = {
        coordinates: offsetPolyline(
          roadCoordinates(this.links, direct),
          (reverse ? 1 : -1) *
            sidewalkOffset(
              this.links.lanes[direct]!,
              sidewalk.width,
              sidewalk.gap
            )
        ),
        fallback: false,
      }
    } else {
      const start = pointKey(reverse ? to : from),
        end = pointKey(reverse ? from : to)
      const queue = new MinQueue(),
        distances = new Map([[start, 0]])
      const previous = new Map<string, { from: string; edge: Edge }>()
      queue.push([0, start])
      let visits = 0,
        reached = false
      for (
        let entry = queue.pop();
        entry && visits < 20000;
        entry = queue.pop()
      ) {
        const [distance, node] = entry
        if (distance !== distances.get(node)) continue
        if (node === end) {
          reached = true
          break
        }
        visits++
        for (const edge of this.graph!.get(node) ?? []) {
          const next = distance + edge.distance
          if (next >= (distances.get(edge.to) ?? Infinity)) continue
          distances.set(edge.to, next)
          previous.set(edge.to, { from: node, edge })
          queue.push([next, edge.to])
        }
      }
      if (reached && start !== end) {
        const edges: Edge[] = []
        for (let node = end; node !== start; ) {
          const step = previous.get(node)!
          edges.push(step.edge)
          node = step.from
        }
        const pieces = edges
          .reverse()
          .map((edge) => offsetPolyline(edge.coordinates, -edge.offset))
        const connectors = pieces.slice(1).flatMap((piece, i) => {
          const a = pieces[i]!.at(-1)!,
            b = piece[0]!
          return distanceMetres(a, b) > 0.05 ? [[a, b]] : []
        })
        const coordinates = pieces.flat()
        if (reverse) coordinates.reverse()
        result = { coordinates, connectors, fallback: false }
      }
    }
    // Endpoints alone cannot prove a route across disconnected or unavailable road geometry.
    result ??= {
      coordinates: offsetPolyline(
        [from, to],
        (reverse ? 1 : -1) * sidewalkOffset(1)
      ),
      fallback: true,
    }
    this.cache.set(cacheKey, result)
    return result
  }
}

export interface WalkingScene {
  segments: SegmentsTable
  paths: Map<string, IndexedRoad>
  fallbackPaths: LonLat[][]
  connectors: LonLat[][]
}

/** Alias only walking rows to sidewalk paths; source events, fractions and clocks remain intact. */
export function prepareWalkingScene(
  segments: SegmentsTable,
  network: SidewalkNetwork
): WalkingScene {
  const paths = new Map<string, IndexedRoad>(),
    fallbackPaths: LonLat[][] = []
  const connectors: LonLat[][] = []
  network.beginScene()
  let ids: string[] | undefined
  for (let i = 0; i < segments.length; i++) {
    if (segments.vehicleKind[i] !== "Person") continue
    const from: LonLat = [segments.lon0[i]!, segments.lat0[i]!],
      to: LonLat = [segments.lon1[i]!, segments.lat1[i]!]
    if (pointKey(from) === pointKey(to)) continue
    const reverse = segments.endFrac[i]! < segments.startFrac[i]!
    const id = `${SIDEWALK_PREFIX}${segments.linkId[i]!}:${pointKey(from)}:${pointKey(to)}:${reverse}`
    ids ??= segments.linkId.slice()
    ids[i] = id
    if (paths.has(id)) continue
    const route = network.route(segments.linkId[i]!, from, to, reverse)
    if (route.blocked) {
      ids[i] = segments.linkId[i]!
      continue
    }
    try {
      paths.set(
        id,
        (route.indexed ??= indexRoad({
          coordinates: route.coordinates,
          osmWayId: "",
          osmNodeIds: [],
          name: "Calçada virtual",
          direction: "forward",
          tags: { virtual: "sidewalk" },
        }))
      )
      if (route.fallback) fallbackPaths.push(route.coordinates)
      connectors.push(...(route.connectors ?? []))
    } catch {
      ids[i] = segments.linkId[i]!
    }
  }
  network.endScene()
  return {
    segments: ids ? { ...segments, linkId: ids } : segments,
    paths,
    fallbackPaths,
    connectors,
  }
}
