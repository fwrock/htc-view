import { LineLayer } from "@deck.gl/layers"
import type { LinksTable } from "../../types/replay"
import { laneMarkings, type Segment } from "../laneGeometry"

export interface ViewWindow { west: number; south: number; east: number; north: number }

/** True when the polyline's bounding box overlaps the window (a long link may start and end
 * outside the window and still cross it). */
export function touchesWindow(coords: readonly (readonly number[])[], w: ViewWindow): boolean {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const c of coords) {
    if (c[0]! < minX) minX = c[0]!
    if (c[0]! > maxX) maxX = c[0]!
    if (c[1]! < minY) minY = c[1]!
    if (c[1]! > maxY) maxY = c[1]!
  }
  return maxX >= w.west && minX <= w.east && maxY >= w.south && minY <= w.north
}

interface Mark { segment: Segment; widthM: number; color: [number, number, number, number] }

const EDGE: [number, number, number, number] = [226, 232, 240, 190]
const DIVIDER: [number, number, number, number] = [250, 250, 250, 235]

/** Lane markings are only generated for links inside `window` (see `snapWindow`): they are
 * physically ~15 cm wide, so they are invisible below ~zoom 16 and not worth building for a
 * whole city. */
export function buildLaneMarks(links: LinksTable, window: ViewWindow): Mark[] {
  const marks: Mark[] = []
  for (let i = 0; i < links.length; i++) {
    const road = links.roadNetwork?.links[links.linkId[i]!]
    const coords = road?.coordinates ?? [[links.lon0[i]!, links.lat0[i]!], [links.lon1[i]!, links.lat1[i]!]]
    if (!touchesWindow(coords, window)) continue
    for (const m of laneMarkings(coords, links.lanes[i]!))
      marks.push({ segment: m.segment, widthM: m.kind === "edge" ? 0.12 : 0.15, color: m.kind === "edge" ? EDGE : DIVIDER })
  }
  return marks
}

export function createLaneLayer(marks: Mark[]): LineLayer<Mark> {
  return new LineLayer<Mark>({
    id: "lane-markings",
    data: marks,
    getSourcePosition: (d) => d.segment[0],
    getTargetPosition: (d) => d.segment[1],
    getColor: (d) => d.color,
    getWidth: (d) => d.widthM,
    widthUnits: "meters",
    widthMinPixels: 0,
    pickable: false,
  })
}

/** Snaps the viewport to a grid of one tile (at the integer zoom) and returns a window of
 * 5×5 tiles around it, so the marking data is rebuilt only when the camera crosses a tile
 * boundary instead of on every pan frame. */
export function snapWindow(longitude: number, latitude: number, zoom: number): { key: string; window: ViewWindow } {
  const z = Math.floor(zoom)
  const cellLon = 360 / 2 ** z
  const cellLat = cellLon * Math.cos(latitude * Math.PI / 180)
  const cx = Math.round(longitude / cellLon), cy = Math.round(latitude / cellLat)
  return {
    key: `${z}:${cx}:${cy}`,
    window: {
      west: (cx - 2.5) * cellLon, east: (cx + 2.5) * cellLon,
      south: (cy - 2.5) * cellLat, north: (cy + 2.5) * cellLat,
    },
  }
}
