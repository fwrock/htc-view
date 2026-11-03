/** Pure polyline helpers (lon/lat in, lon/lat out, distances in metres) for drawing lane
 * markings, rail gauge lines and sleepers at their physical size. */
import { LANE_WIDTH_M } from "./entityGeometry"

export type LonLat = [number, number]
export type Segment = [LonLat, LonLat]

const M_PER_DEG = 111195

function frame(lat: number) {
  return { kx: M_PER_DEG * Math.cos(lat * Math.PI / 180), ky: M_PER_DEG }
}

/** Shifts a polyline sideways by `offsetM` (positive = left of travel direction). Interior
 * vertices use a limited miter so bends keep a constant lateral distance. */
export function offsetPolyline(coords: readonly (readonly number[])[], offsetM: number): LonLat[] {
  if (coords.length < 2 || offsetM === 0) return coords.map(c => [c[0]!, c[1]!])
  const { kx, ky } = frame(coords[0]![1]!)
  const pts = coords.map(c => [(c[0]! - coords[0]![0]!) * kx, (c[1]! - coords[0]![1]!) * ky])
  const normals: [number, number][] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1]![0]! - pts[i]![0]!, dy = pts[i + 1]![1]! - pts[i]![1]!
    const len = Math.hypot(dx, dy) || 1
    normals.push([-dy / len, dx / len])
  }
  return pts.map((p, i) => {
    const a = normals[Math.max(0, i - 1)]!, b = normals[Math.min(normals.length - 1, i)]!
    let nx = a[0] + b[0], ny = a[1] + b[1]
    const len = Math.hypot(nx, ny)
    let miter = 1
    if (len < 1e-9) { nx = a[0]; ny = a[1] } else {
      nx /= len; ny /= len
      miter = Math.min(2, 1 / Math.max(nx * a[0] + ny * a[1], 1e-6))
    }
    return [coords[0]![0]! + (p[0]! + nx * miter * offsetM) / kx, coords[0]![1]! + (p[1]! + ny * miter * offsetM) / ky] as LonLat
  })
}

export function polylineSegments(coords: readonly (readonly number[])[]): Segment[] {
  const out: Segment[] = []
  for (let i = 0; i < coords.length - 1; i++)
    out.push([[coords[i]![0]!, coords[i]![1]!], [coords[i + 1]![0]!, coords[i + 1]![1]!]])
  return out
}

/** Walks the polyline emitting `dashM` long strokes separated by `gapM` (continuous across vertices). */
export function dashPolyline(coords: readonly (readonly number[])[], dashM: number, gapM: number): Segment[] {
  const out: Segment[] = []
  const { kx, ky } = frame(coords[0]?.[1] ?? 0)
  const period = dashM + gapM
  let travelled = 0
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i]!, b = coords[i + 1]!
    const len = Math.hypot((b[0]! - a[0]!) * kx, (b[1]! - a[1]!) * ky)
    if (!(len > 0)) continue
    for (let k = Math.floor(travelled / period); k * period < travelled + len; k++) {
      const start = Math.max(k * period, travelled), end = Math.min(k * period + dashM, travelled + len)
      if (end <= start) continue
      const t0 = (start - travelled) / len, t1 = (end - travelled) / len
      out.push([
        [a[0]! + (b[0]! - a[0]!) * t0, a[1]! + (b[1]! - a[1]!) * t0],
        [a[0]! + (b[0]! - a[0]!) * t1, a[1]! + (b[1]! - a[1]!) * t1],
      ])
    }
    travelled += len
  }
  return out
}

/** Short strokes perpendicular to the polyline every `spacingM` (railway sleepers). */
export function sleeperSegments(coords: readonly (readonly number[])[], spacingM: number, halfWidthM: number): Segment[] {
  const out: Segment[] = []
  const { kx, ky } = frame(coords[0]?.[1] ?? 0)
  let travelled = 0
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i]!, b = coords[i + 1]!
    const dx = (b[0]! - a[0]!) * kx, dy = (b[1]! - a[1]!) * ky
    const len = Math.hypot(dx, dy)
    if (!(len > 0)) continue
    const nx = -dy / len, ny = dx / len
    for (let m = Math.max(0, Math.ceil((travelled - spacingM / 2) / spacingM)); spacingM / 2 + m * spacingM < travelled + len; m++) {
      const t = (spacingM / 2 + m * spacingM - travelled) / len
      const cx = a[0]! + (b[0]! - a[0]!) * t, cy = a[1]! + (b[1]! - a[1]!) * t
      out.push([[cx - nx * halfWidthM / kx, cy - ny * halfWidthM / ky], [cx + nx * halfWidthM / kx, cy + ny * halfWidthM / ky]])
    }
    travelled += len
  }
  return out
}

export interface LaneMarking { segment: Segment; kind: "edge" | "divider" }

/** Edge lines for every road plus dashed dividers between the lanes of a multi-lane link. */
export function laneMarkings(coords: readonly (readonly number[])[], lanes: number): LaneMarking[] {
  const n = Math.max(1, Math.round(lanes))
  const half = n * LANE_WIDTH_M / 2
  const out: LaneMarking[] = []
  for (const side of [-half + 0.1, half - 0.1])
    for (const segment of polylineSegments(offsetPolyline(coords, side))) out.push({ segment, kind: "edge" })
  for (let k = 1; k < n; k++)
    for (const segment of dashPolyline(offsetPolyline(coords, -half + k * LANE_WIDTH_M), 3, 5))
      out.push({ segment, kind: "divider" })
  return out
}
