/// <reference lib="webworker" />
import {
  entityAngle,
  lanePosition,
  positionInLane,
} from "../map/entityGeometry"
import type { SegmentBuffers } from "./segmentBuffers"
import {
  buildSpatialGrid,
  queryGrid,
  type Bounds,
  type SpatialGrid,
} from "./spatialGrid"
import { speedColor } from "../map/speedColor"
import {
  positionOnPackedRoad,
  directionOnPackedRoad,
} from "../map/roadGeometry"

// Avoids pulling in `lib.dom` (already loaded by the app's tsconfig) fighting with
// `lib.webworker`'s conflicting `self` type — cast once, use the narrow surface we need.
const ctx = self as unknown as DedicatedWorkerGlobalScope

// Hard safety cap on how many vehicles a single frame response can carry, regardless of how
// many are actually active+visible. Beyond this, the caller should be on the aggregated
// heatmap path instead of asking for individual points — see docs/KNOWN_GAPS.md.
const MAX_OUTPUT = 300_000

let buffers: SegmentBuffers | null = null
let grid: SpatialGrid | null = null
let curvedIndices = new Int32Array(0)

type InitMessage = { type: "init"; buffers: SegmentBuffers }
type FrameRequest = {
  type: "frame"
  requestId: number
  currentTick: number
  bounds: Bounds
}
type InMessage = InitMessage | FrameRequest

ctx.onmessage = (event: MessageEvent<InMessage>) => {
  const msg = event.data
  if (msg.type === "init") {
    buffers = msg.buffers
    const indexed: number[] = []
    if (buffers.roads)
      for (let i = 0; i < buffers.length; i++)
        if (buffers.roads.pathIndex[i]! >= 0) indexed.push(i)
    curvedIndices = Int32Array.from(indexed)
    grid = buildSpatialGrid(
      buffers.lat0,
      buffers.lon0,
      buffers.lat1,
      buffers.lon1
    )
    ctx.postMessage({ type: "ready", length: buffers.length })
    return
  }
  if (msg.type === "frame") {
    if (!buffers || !grid) return
    computeFrame(buffers, grid, msg.requestId, msg.currentTick, msg.bounds)
  }
}

function computeFrame(
  b: SegmentBuffers,
  g: SpatialGrid,
  requestId: number,
  currentTick: number,
  bounds: Bounds
): void {
  const cap = Math.min(b.length, MAX_OUTPUT)
  const positions = new Float32Array(cap * 2)
  const segmentIndices = new Uint32Array(cap)
  const colors = new Uint8Array(cap * 3)
  const weights = new Float32Array(cap) // congestion weight for the heatmap path: 1/speed
  let count = 0
  let truncated = false

  // Curved road/sidewalk paths may enter the viewport beyond their endpoint chord.
  // Keep uncurved vehicle rows on the grid even when a few walking paths are present.
  const candidates = frameCandidates(b, g, bounds)
  for (const i of candidates) {
    const start = b.startTick[i]!
    const end = b.endTick[i]!
    if (currentTick < start || currentTick > end) continue

    const span = end - start
    const t =
      span <= 0 ? 1 : Math.min(1, Math.max(0, (currentTick - start) / span))
    const frac = b.startFrac[i]! + (b.endFrac[i]! - b.startFrac[i]!) * t
    const roadPosition = b.roads ? positionOnPackedRoad(b.roads, i, frac) : null
    let lat = roadPosition?.[1] ?? b.lat0[i]! + (b.lat1[i]! - b.lat0[i]!) * frac
    let lon = roadPosition?.[0] ?? b.lon0[i]! + (b.lon1[i]! - b.lon0[i]!) * frac
    const angle =
      (b.roads ? directionOnPackedRoad(b.roads, i, frac) : null) ??
      entityAngle([b.lon0[i]!, b.lat0[i]!], [b.lon1[i]!, b.lat1[i]!])
    const lane = lanePosition(b.startLane[i], b.endLane[i], t, b.laneCount[i]!)
    ;[lon, lat] = positionInLane([lon, lat], angle, lane, b.laneCount[i]!)
    if (
      b.roads &&
      (lon < bounds.west ||
        lon > bounds.east ||
        lat < bounds.south ||
        lat > bounds.north)
    )
      continue
    if (count >= MAX_OUTPUT) {
      truncated = true
      break
    }
    const [r, g2, bl] = speedColor(b.speedKmh[i]!, b.freeSpeedKmh[i]!)
    const speed = b.speedKmh[i]!

    positions[count * 2] = lon
    positions[count * 2 + 1] = lat
    colors[count * 3] = r
    colors[count * 3 + 1] = g2
    colors[count * 3 + 2] = bl
    weights[count] = speed > 0 ? 1 / speed : 1
    segmentIndices[count] = i
    count++
  }

  // `.slice()` (not `.subarray()`) so the transferred buffer is exactly the size actually
  // used — a `.subarray()` view still points at the full `MAX_OUTPUT`-sized allocation
  // underneath, which would transfer far more bytes than necessary once `count` is small.
  const outPositions = positions.slice(0, count * 2)
  const outIndices = segmentIndices.slice(0, count)
  const outColors = colors.slice(0, count * 3)
  const outWeights = weights.slice(0, count)
  ctx.postMessage(
    {
      type: "frame",
      requestId,
      count,
      positions: outPositions,
      colors: outColors,
      segmentIndices: outIndices,
      weights: outWeights,
      truncated,
    },
    [outPositions.buffer, outColors.buffer, outWeights.buffer, outIndices.buffer]
  )
}

function* frameCandidates(
  b: SegmentBuffers,
  g: SpatialGrid,
  bounds: Bounds
): Generator<number> {
  yield* curvedIndices
  for (const i of queryGrid(g, bounds))
    if (!b.roads || b.roads.pathIndex[i]! < 0) yield i
}
