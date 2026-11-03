import { PathLayer } from "@deck.gl/layers"
import type { LinksTable } from "../../types/replay"
import { offsetPolyline, type LonLat } from "../laneGeometry"
import {
  SIDEWALK_WIDTH_M,
  sidewalkOffset,
  roadCoordinates,
  linkSidewalk,
} from "../sidewalks"
import { touchesWindow, type ViewWindow } from "./laneLayer"

interface Sidewalk {
  path: LonLat[]
  width: number
  fallback: boolean
}

export function buildSidewalks(
  links: LinksTable,
  window: ViewWindow,
  fallbackPaths: LonLat[][] = [],
  connectors: LonLat[][] = []
): Sidewalk[] {
  const data: Sidewalk[] = []
  for (let i = 0; i < links.length; i++) {
    const sidewalk = linkSidewalk(links, i)
    if (!sidewalk.enabled) continue
    const coordinates = roadCoordinates(links, i)
    if (!touchesWindow(coordinates, window)) continue
    const offset = sidewalkOffset(links.lanes[i]!, sidewalk.width, sidewalk.gap)
    for (const side of [-1, 1])
      data.push({
        path: offsetPolyline(coordinates, side * offset),
        fallback: false,
        width: sidewalk.width,
      })
  }
  for (const path of connectors)
    if (touchesWindow(path, window))
      data.push({ path, fallback: false, width: SIDEWALK_WIDTH_M })
  for (const path of fallbackPaths)
    if (touchesWindow(path, window))
      data.push({ path, fallback: true, width: SIDEWALK_WIDTH_M })
  return data
}

export function createSidewalkLayer(
  sidewalks: Sidewalk[]
): PathLayer<Sidewalk> {
  return new PathLayer<Sidewalk>({
    id: "virtual-sidewalks",
    data: sidewalks,
    getPath: (d) => d.path,
    getWidth: (d) => d.width,
    getColor: (d) => (d.fallback ? [148, 163, 184, 100] : [166, 174, 181, 210]),
    widthUnits: "meters",
    widthMinPixels: 0,
    jointRounded: true,
    capRounded: true,
    pickable: false,
  })
}
