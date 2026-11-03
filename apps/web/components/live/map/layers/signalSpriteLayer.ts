import { IconLayer } from "@deck.gl/layers"
import type {
  LinksTable,
  NodesTable,
  TrafficSignalConfig,
} from "../../types/replay"
import { signalSprite, type SignalAppearance } from "../entitySprites"
import { computeSignalPhases } from "../trafficSignal"
import { entityAngle, offsetMetres, LANE_WIDTH_M } from "../entityGeometry"

export interface SignalMarker {
  nodeIndex: number
  position: [number, number]
  signal?: TrafficSignalConfig
  origin?: string
  angle: number
}

/** One head per incoming link. A single node-level green would misrepresent cross traffic. */
export function buildSignalMarkers(
  nodes: NodesTable,
  links: LinksTable,
  signals: TrafficSignalConfig[]
): SignalMarker[] {
  const nodeIndex = new Map(nodes.nodeId.map((id, i) => [id, i]))
  const linkIndex = new Map(links.linkId.map((id, i) => [id, i]))
  const covered = new Set<number>()
  const markers: SignalMarker[] = []
  for (const signal of signals) {
    for (const origin of new Set(signal.phases.map((phase) => phase.origin))) {
      const li = linkIndex.get(origin)
      if (li === undefined) continue
      const endpoint = [links.lon1[li]!, links.lat1[li]!]
      // A signal may control several nodes: associate each origin with its own endpoint.
      const ni = signal.nodeIds
        .map((id) => nodeIndex.get(id))
        .find(
          (i) =>
            i !== undefined &&
            Math.abs(nodes.lon[i]! - endpoint[0]!) < 1e-5 &&
            Math.abs(nodes.lat[i]! - endpoint[1]!) < 1e-5
        )
      if (ni === undefined) continue
      const coordinates = links.roadNetwork?.links[origin]?.coordinates
      const from = coordinates?.[coordinates.length - 2] ?? [
        links.lon0[li]!,
        links.lat0[li]!,
      ]
      const angle = entityAngle(from, endpoint)
      const bearing = (-angle * Math.PI) / 180
      const shoulder = (Math.max(1, links.lanes[li]!) * LANE_WIDTH_M) / 2 + 0.6
      const retreat = Math.min(6, Math.max(0, links.lengthM[li]!) / 2)
      markers.push({
        nodeIndex: ni,
        signal,
        origin,
        angle,
        position: offsetMetres(
          endpoint,
          -Math.sin(bearing) * retreat + Math.cos(bearing) * shoulder,
          -Math.cos(bearing) * retreat - Math.sin(bearing) * shoulder
        ),
      })
      covered.add(ni)
    }
  }
  for (let i = 0; i < nodes.length; i++) {
    if (nodes.hasSignal[i] && !covered.has(i))
      markers.push({
        nodeIndex: i,
        position: [nodes.lon[i]!, nodes.lat[i]!],
        angle: 0,
      })
  }
  return markers
}

export function signalAppearance(
  marker: SignalMarker,
  tick: number
): SignalAppearance {
  const signal = marker.signal
  if (!signal || tick < signal.startTick || !(signal.cycleDuration > 0))
    return "Unknown"
  return (
    computeSignalPhases(signal, tick).find(
      (phase) => phase.origin === marker.origin
    )?.state ?? "Unknown"
  )
}

export function createSignalSpriteLayer(
  markers: SignalMarker[],
  currentTick: number
): IconLayer<SignalMarker> {
  return new IconLayer<SignalMarker>({
    id: "signals-svg",
    data: markers,
    getPosition: (d) => d.position,
    getIcon: (d) => signalSprite(signalAppearance(d, currentTick)),
    getSize: 2.4,
    getAngle: (d) => d.angle,
    sizeUnits: "meters",
    billboard: false,
    pickable: true,
    updateTriggers: { getIcon: currentTick },
  })
}
