import { LineLayer } from "@deck.gl/layers"
import type { RailLinksTable } from "../../types/replay"
import { LANE_WIDTH_M } from "../entityGeometry"
import { offsetPolyline, sleeperSegments, type Segment } from "../laneGeometry"
import { touchesWindow, type ViewWindow } from "./laneLayer"

/** Standard gauge is 1.435 m; rails sit half of that either side of the track centre. */
const GAUGE_M = 1.435
const TRACK_SPACING_M = 4

interface RailStroke {
  segment: Segment
  widthM: number
  color: [number, number, number, number]
}

const BED = { rail: [104, 94, 84, 235], subway: [76, 72, 108, 235] } as const
const SLEEPER: [number, number, number, number] = [128, 92, 60, 255]
const STEEL: [number, number, number, number] = [214, 220, 228, 255]

function tracksOf(railLinks: RailLinksTable, i: number): { coords: [number, number][]; subway: boolean }[] {
  const base: [number, number][] = [[railLinks.lon0[i]!, railLinks.lat0[i]!], [railLinks.lon1[i]!, railLinks.lat1[i]!]]
  const subway = Boolean(railLinks.subwayLine[i])
  const n = Math.max(1, railLinks.lanes[i]!)
  return Array.from({ length: n }, (_, k) => ({
    coords: n === 1 ? base : offsetPolyline(base, (k - (n - 1) / 2) * TRACK_SPACING_M),
    subway,
  }))
}

/** Ballast bed + two steel rails per track, always; sleepers only inside `detail` because they
 * are ~25 cm wide and a long line has well over a thousand of them per kilometre. */
export function buildRailStrokes(railLinks: RailLinksTable, detail: ViewWindow | null): { bed: RailStroke[]; fine: RailStroke[] } {
  const bed: RailStroke[] = [], fine: RailStroke[] = []
  for (let i = 0; i < railLinks.length; i++) {
    for (const { coords, subway } of tracksOf(railLinks, i)) {
      bed.push({ segment: [coords[0]!, coords[coords.length - 1]!], widthM: Math.min(LANE_WIDTH_M, TRACK_SPACING_M - 0.4) , color: [...BED[subway ? "subway" : "rail"]] as RailStroke["color"] })
      if (detail && touchesWindow(coords, detail))
        for (const segment of sleeperSegments(coords, 0.7, 1.2)) fine.push({ segment, widthM: 0.26, color: SLEEPER })
      for (const side of [-GAUGE_M / 2, GAUGE_M / 2]) {
        const rail = offsetPolyline(coords, side)
        fine.push({ segment: [rail[0]!, rail[rail.length - 1]!], widthM: 0.14, color: STEEL })
      }
    }
  }
  return { bed, fine }
}

function strokeLayer(id: string, data: RailStroke[], minPx: number): LineLayer<RailStroke> {
  return new LineLayer<RailStroke>({
    id, data,
    getSourcePosition: (d) => d.segment[0],
    getTargetPosition: (d) => d.segment[1],
    getColor: (d) => d.color,
    getWidth: (d) => d.widthM,
    widthUnits: "meters",
    widthMinPixels: minPx,
    pickable: false,
  })
}

/** Rail network drawn as railway: bed, sleepers and two rails — never as a road-like stroke. */
export function createRailLinkLayers(railLinks: RailLinksTable, detail: ViewWindow | null): LineLayer<RailStroke>[] {
  const { bed, fine } = buildRailStrokes(railLinks, detail)
  return [strokeLayer("rail-bed", bed, 2), strokeLayer("rail-detail", fine, 0)]
}
