import { ScatterplotLayer } from "@deck.gl/layers"
import type { SegmentsTable } from "../../types/replay"
import { entityAngle, lanePosition, positionInLane } from "../entityGeometry"
import { speedColor } from "../speedColor"
import {
  positionOnRoad,
  directionOnRoad,
  type IndexedRoad,
} from "../roadGeometry"

export interface VehiclePosition {
  lane?: number
  linkId: string
  vehicleId: string
  vehicleKind: string
  position: [number, number]
  angle: number
  speedKmh: number
  freeSpeedKmh: number
  co2Grams: number
  noxGrams: number
  pm25Grams: number
}

/** Scans all segments and interpolates the position of every vehicle whose
 * [startTick, endTick] window covers `currentTick`. O(segments) per frame, no viewport
 * culling — fine at the SVG/shape representations' intended scale (thousands, where
 * individual icons are still legible). The scale-oriented path (worker + binary attributes +
 * viewport-grid culling) lives in `data/useVehicleWorker.ts` / `workers/vehicleWorker.ts` and
 * backs the "circle" representation and the heatmap instead — see docs/ARCHITECTURE.md.
 *
 * `freeSpeedLookup` supplies each vehicle's current link's free-flow speed, since a segment
 * only carries its own `speedKmh` — coloring "relative to this road's speed limit" needs both.
 */
export function computeVehiclePositions(
  segments: SegmentsTable,
  currentTick: number,
  freeSpeedLookup: Map<string, number>,
  roads?: Map<string, IndexedRoad>,
  laneCounts?: Map<string, number>
): VehiclePosition[] {
  const positions: VehiclePosition[] = []
  for (let i = 0; i < segments.length; i++) {
    const start = segments.startTick[i]!
    const end = segments.endTick[i]!
    if (currentTick < start || currentTick > end) continue

    const span = end - start
    const t =
      span <= 0 ? 1 : Math.min(1, Math.max(0, (currentTick - start) / span))
    const frac =
      segments.startFrac[i]! +
      (segments.endFrac[i]! - segments.startFrac[i]!) * t
    const road = roads?.get(segments.linkId[i]!)
    const roadPosition = road ? positionOnRoad(road, frac) : null
    const lat =
      roadPosition?.[1] ??
      segments.lat0[i]! + (segments.lat1[i]! - segments.lat0[i]!) * frac
    const lon =
      roadPosition?.[0] ??
      segments.lon0[i]! + (segments.lon1[i]! - segments.lon0[i]!) * frac

    const angle =
      (road
        ? directionOnRoad(road, frac)
        : entityAngle(
            [segments.lon0[i]!, segments.lat0[i]!],
            [segments.lon1[i]!, segments.lat1[i]!]
          )) + (segments.endFrac[i]! < segments.startFrac[i]! ? 180 : 0)
    const lanes = laneCounts?.get(segments.linkId[i]!) ?? 1
    const lane = lanePosition(
      segments.startLane?.[i],
      segments.endLane?.[i],
      t,
      lanes
    )
    positions.push({
      vehicleId: segments.vehicleId[i]!,
      vehicleKind: segments.vehicleKind[i]!,
      position: positionInLane([lon, lat], angle, lane, lanes),
      lane,
      linkId: segments.linkId[i]!,
      angle,
      speedKmh: segments.speedKmh[i]!,
      freeSpeedKmh: freeSpeedLookup.get(segments.linkId[i]!) ?? 40,
      co2Grams: segments.co2Grams[i]!,
      noxGrams: segments.noxGrams[i]!,
      pm25Grams: segments.pm25Grams[i]!,
    })
  }
  const unique = new Map<string, VehiclePosition>()
  for (const position of positions)
    unique.set(`${position.vehicleKind}:${position.vehicleId}`, position)
  return [...unique.values()]
}

/** Plain circle, colored by speed bucket. The simplest of the three representation modes —
 * used when the user hasn't picked "sprite" or "shape" (no vehicle-kind distinction).
 */
export function createVehicleScatterLayer(
  positions: VehiclePosition[]
): ScatterplotLayer<VehiclePosition> {
  return new ScatterplotLayer<VehiclePosition>({
    id: "vehicles",
    data: positions,
    getPosition: (d) => d.position,
    getRadius: 6,
    radiusUnits: "pixels",
    getFillColor: (d) => speedColor(d.speedKmh, d.freeSpeedKmh),
    pickable: true,
    updateTriggers: {
      getPosition: positions,
      getFillColor: positions,
    },
  })
}
