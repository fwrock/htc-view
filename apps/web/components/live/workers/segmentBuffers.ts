import type { SegmentsTable } from "../types/replay"
import {
  packRoads,
  type IndexedRoad,
  type PackedRoads,
} from "../map/roadGeometry"

/** Pure-numeric, per-segment typed arrays — everything the worker needs to interpolate
 * position/speed and nothing it doesn't (no vehicle_id/link_id strings, no vehicle_kind).
 * Kept separate from `SegmentsTable` because these are built once as *copies* so their
 * underlying `ArrayBuffer`s can be transferred to the worker (transferring hands off
 * ownership — the main thread's original `SegmentsTable` arrays, still used by the
 * SVG/shape detail-view path, must not be neutered by that transfer).
 */
export interface SegmentBuffers {
  startLane: Float32Array
  endLane: Float32Array
  laneCount: Float32Array
  roads?: PackedRoads
  length: number
  lat0: Float32Array
  lon0: Float32Array
  lat1: Float32Array
  lon1: Float32Array
  startTick: Float64Array
  endTick: Float64Array
  startFrac: Float32Array
  endFrac: Float32Array
  speedKmh: Float32Array
  freeSpeedKmh: Float32Array
}

export function buildSegmentBuffers(
  segments: SegmentsTable,
  freeSpeedLookup: Map<string, number>,
  roads?: Map<string, IndexedRoad>,
  laneCounts?: Map<string, number>
): SegmentBuffers {
  const n = segments.length
  const freeSpeedKmh = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    freeSpeedKmh[i] = freeSpeedLookup.get(segments.linkId[i]!) ?? 40
  }
  return {
    roads: roads?.size ? packRoads(roads, segments.linkId) : undefined,
    length: n,
    startLane: segments.startLane?.slice() ?? new Float32Array(n).fill(NaN),
    endLane: segments.endLane?.slice() ?? new Float32Array(n).fill(NaN),
    laneCount: Float32Array.from(
      segments.linkId,
      (id) => laneCounts?.get(id) ?? 1
    ),
    lat0: segments.lat0.slice(),
    lon0: segments.lon0.slice(),
    lat1: segments.lat1.slice(),
    lon1: segments.lon1.slice(),
    startTick: segments.startTick.slice(),
    endTick: segments.endTick.slice(),
    startFrac: segments.startFrac.slice(),
    endFrac: segments.endFrac.slice(),
    speedKmh: segments.speedKmh.slice(),
    freeSpeedKmh,
  }
}

/** ArrayBuffers eligible for the worker's `postMessage` transfer list — after this, the main
 * thread's copies (not the originals in `SegmentsTable`, these are already independent slices)
 * are no longer usable, which is fine since nothing on the main thread reads `SegmentBuffers`
 * directly once it's handed to the worker. */
export function segmentBufferTransferList(
  buffers: SegmentBuffers
): ArrayBufferLike[] {
  const transfers: ArrayBufferLike[] = [
    buffers.startLane.buffer,
    buffers.endLane.buffer,
    buffers.laneCount.buffer,
    buffers.lat0.buffer,
    buffers.lon0.buffer,
    buffers.lat1.buffer,
    buffers.lon1.buffer,
    buffers.startTick.buffer,
    buffers.endTick.buffer,
    buffers.startFrac.buffer,
    buffers.endFrac.buffer,
    buffers.speedKmh.buffer,
    buffers.freeSpeedKmh.buffer,
  ]
  if (buffers.roads)
    transfers.push(
      buffers.roads.pathIndex.buffer,
      buffers.roads.offsets.buffer,
      buffers.roads.coordinates.buffer,
      buffers.roads.cumulative.buffer
    )
  return transfers
}
