import { LineLayer, PathLayer } from "@deck.gl/layers"
import type { RoadPath } from "../../types/replay"
import type { LinksTable } from "../../types/replay"

/** Metadata for one link, materialized on demand (hover/click only — never per frame) from
 * `LinksTable`'s typed arrays at a picked row index. Kept as a plain object only because the
 * tooltip/panel components want named fields; the render path below never builds one of
 * these per link — see the "confirmed engine bug" style note in docs/KNOWN_GAPS.md about why
 * that per-object path doesn't scale (empirically: ~38s of unexplained stall for 718k links
 * before this was binary).
 */
export interface LinkSegment {
  hostNode?: string
  osm?: RoadPath
  linkId: string
  sourcePosition: [number, number]
  targetPosition: [number, number]
  lengthM: number
  lanes: number
  simulationMode: string
  freeSpeedKmh: number
}

export function linkSegmentAt(links: LinksTable, index: number): LinkSegment {
  return {
    osm: links.roadNetwork?.links[links.linkId[index]!],
    linkId: links.linkId[index]!,
    sourcePosition: [links.lon0[index]!, links.lat0[index]!],
    targetPosition: [links.lon1[index]!, links.lat1[index]!],
    lengthM: links.lengthM[index]!,
    lanes: links.lanes[index]!,
    simulationMode: links.simulationMode[index]!,
    freeSpeedKmh: links.freeSpeedKmh[index]!,
  }
}

const DEFAULT_COLOR: [number, number, number, number] = [120, 120, 130, 160]
const SELECTED_COLOR: [number, number, number, number] = [255, 202, 40, 255]

/** Precomputes the interleaved [lon,lat] position buffers once per `links` load — these never
 * change after that, only `selectedLinkId` does (recolored separately, far more cheaply than
 * rebuilding positions).
 */
export function buildPositionBuffers(links: LinksTable): LinkPositionBuffers {
  const n = links.length
  const source = new Float32Array(n * 2)
  const target = new Float32Array(n * 2)
  for (let i = 0; i < n; i++) {
    source[i * 2] = links.lon0[i]!
    source[i * 2 + 1] = links.lat0[i]!
    target[i * 2] = links.lon1[i]!
    target[i * 2 + 1] = links.lat1[i]!
  }
  return { source, target }
}

function buildColorBuffer(
  links: LinksTable,
  selectedLinkId: string | null
): Uint8Array {
  const n = links.length
  const colors = new Uint8Array(n * 4)
  for (let i = 0; i < n; i++) {
    const c =
      links.linkId[i] === selectedLinkId ? SELECTED_COLOR : DEFAULT_COLOR
    colors[i * 4] = c[0]
    colors[i * 4 + 1] = c[1]
    colors[i * 4 + 2] = c[2]
    colors[i * 4 + 3] = c[3]
  }
  return colors
}

function buildWidthBuffer(
  links: LinksTable,
  selectedLinkId: string | null
): Float32Array {
  const n = links.length
  const widths = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    widths[i] =
      Math.max(1, links.lanes[i]!) * 3.2 +
      (links.linkId[i] === selectedLinkId ? 0.6 : 0)
  }
  return widths
}

export interface LinkPositionBuffers {
  source: Float32Array
  target: Float32Array
}

/** Binary-attribute LineLayer for the static road network — built once from `LinksTable`'s
 * own typed arrays (already Float32Array from Arrow), with no per-link JS object and no
 * per-link accessor-function call. This is what made a 718k-link scenario go from a ~38s
 * unresponsive stall (JS-object `LineLayer` calling accessors 718k times) to sub-second.
 */
export function createLinkLayerBinary(
  links: LinksTable,
  positions: LinkPositionBuffers,
  selectedLinkId: string | null
): LineLayer | PathLayer {
  if (links.roadNetwork) {
    const paths = links.linkId.map((linkId, index) => ({
      linkId,
      road: links.roadNetwork!.links[linkId]!,
      widthM: Math.max(1, links.lanes[index]!) * 3.2,
    }))
    return new PathLayer({
      id: "links",
      data: paths,
      getPath: (item) => item.road.coordinates,
      getColor: (item) =>
        item.linkId === selectedLinkId ? SELECTED_COLOR : DEFAULT_COLOR,
      getWidth: (item) =>
        item.widthM + (item.linkId === selectedLinkId ? 0.6 : 0),
      widthUnits: "meters",
      widthMinPixels: 1,
      pickable: true,
      autoHighlight: true,
      updateTriggers: { getColor: selectedLinkId, getWidth: selectedLinkId },
    })
  }
  const colors = buildColorBuffer(links, selectedLinkId)
  const widths = buildWidthBuffer(links, selectedLinkId)
  return new LineLayer({
    id: "links",
    data: {
      length: links.length,
      attributes: {
        getSourcePosition: { value: positions.source, size: 2 },
        getTargetPosition: { value: positions.target, size: 2 },
        getColor: { value: colors, size: 4 },
        getWidth: { value: widths, size: 1 },
      },
    },
    widthUnits: "meters",
    widthMinPixels: 1,
    pickable: true,
    updateTriggers: {
      getColor: selectedLinkId,
      getWidth: selectedLinkId,
    },
  })
}
