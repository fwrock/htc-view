import type {
  BoundingBox,
  LinksTable,
  NodesTable,
  TrafficSignalConfig,
  RoadNetwork,
} from "../components/live/types/replay"
import { validateRoadNetwork } from "../components/live/map/roadGeometry"

export const NATIVE_API_BASE =
  process.env.NEXT_PUBLIC_SIMEDAPE_API_URL ?? "http://localhost:5000"
export type StreamReady = {
  type: "stream_ready"
  protocol: "htc.live.v1"
  simulation_id: string
  connection_id: string
  bridge_id: string
}
export type NativeLiveDescriptor = {
  schema?: "htc.native-live.v1"
  run_id: string
  state: string
  status: string
  error?: string
  geometry_sha256?: string
  geometry_url?: string
  ready_url?: string
  ws_url?: string
  readiness_token?: string
}
export type NativeLiveGeometry = {
  schema: "htc.live-geometry.v1"
  run_id: string
  scenario_sha256: string
  nodes: { id: string; lat: number; lon: number; has_signal: boolean }[]
  links: {
    id: string
    from: string
    to: string
    length_m: number
    lanes: number
    free_speed_kmh: number
    simulation_mode: string
  }[]
  signals: TrafficSignalConfig[]
  road_network: RoadNetwork | null
  tick_min: number
  tick_max: number
  ticks_per_second: number
  bounds: BoundingBox
}

export async function liveRequest<T>(
  route: string,
  body?: unknown
): Promise<T> {
  const response = await fetch(
    NATIVE_API_BASE + route,
    body === undefined
      ? { cache: "no-store" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
  )
  const data = await response.json()
  if (!response.ok)
    throw new Error(data.error ?? `Live HTTP ${response.status}`)
  return data as T
}

export async function loadLiveGeometry(descriptor: NativeLiveDescriptor) {
  if (!descriptor.geometry_url || !descriptor.geometry_sha256)
    throw new Error("Live geometry is not ready")
  const response = await fetch(NATIVE_API_BASE + descriptor.geometry_url, {
    cache: "no-store",
  })
  if (!response.ok) throw new Error("Could not load run geometry")
  const bytes = await response.arrayBuffer()
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
  if (hash !== descriptor.geometry_sha256)
    throw new Error("Live geometry fingerprint does not match this run")
  return decodeLiveGeometry(
    JSON.parse(new TextDecoder().decode(bytes)),
    descriptor.run_id
  )
}

export function decodeLiveGeometry(raw: NativeLiveGeometry, runId: string) {
  if (raw.schema !== "htc.live-geometry.v1" || raw.run_id !== runId)
    throw new Error("Geometry belongs to a different live run")
  if (
    !Number.isFinite(raw.ticks_per_second) ||
    raw.ticks_per_second <= 0 ||
    raw.tick_min > raw.tick_max
  )
    throw new Error("Invalid live clock")
  const byId = new Map<string, NativeLiveGeometry["nodes"][number]>()
  raw.nodes.forEach((node) => {
    if (
      typeof node.id !== "string" ||
      byId.has(node.id) ||
      !Number.isFinite(node.lat) ||
      !Number.isFinite(node.lon) ||
      Math.abs(node.lat) > 85.05112878 ||
      Math.abs(node.lon) > 180
    )
      throw new Error("Invalid live node geometry")
    byId.set(node.id, node)
  })
  const ids = new Set<string>()
  raw.links.forEach((link) => {
    if (
      typeof link.id !== "string" ||
      ids.has(link.id) ||
      !byId.has(link.from) ||
      !byId.has(link.to) ||
      !(link.length_m > 0)
    )
      throw new Error("Invalid live link geometry")
    ids.add(link.id)
  })
  const nodes: NodesTable = {
    length: raw.nodes.length,
    nodeId: raw.nodes.map((node) => node.id),
    lat: Float32Array.from(raw.nodes, (node) => node.lat),
    lon: Float32Array.from(raw.nodes, (node) => node.lon),
    hasSignal: Int32Array.from(raw.nodes, (node) => (node.has_signal ? 1 : 0)),
  }
  const links: LinksTable = {
    length: raw.links.length,
    linkId: raw.links.map((link) => link.id),
    lat0: Float32Array.from(raw.links, (link) => byId.get(link.from)!.lat),
    lon0: Float32Array.from(raw.links, (link) => byId.get(link.from)!.lon),
    lat1: Float32Array.from(raw.links, (link) => byId.get(link.to)!.lat),
    lon1: Float32Array.from(raw.links, (link) => byId.get(link.to)!.lon),
    lengthM: Float32Array.from(raw.links, (link) => link.length_m),
    lanes: Int32Array.from(raw.links, (link) => link.lanes),
    freeSpeedKmh: Float32Array.from(raw.links, (link) => link.free_speed_kmh),
    simulationMode: raw.links.map((link) => link.simulation_mode),
  }
  if (raw.road_network)
    links.roadNetwork = validateRoadNetwork(raw.road_network, links)
  return { raw, nodes, links }
}

export function parseStreamFrame(text: string, simulationId?: string) {
  const frame = JSON.parse(text)
  if (frame.type === "stream_ready") {
    if (
      frame.protocol !== "htc.live.v1" ||
      frame.simulation_id !== simulationId ||
      typeof frame.connection_id !== "string" ||
      typeof frame.bridge_id !== "string"
    )
      return null
    return frame as StreamReady
  }
  if (simulationId && frame.simulationId !== simulationId) return null
  if (
    typeof frame.simulationId !== "string" ||
    typeof frame.entityId !== "string" ||
    !Number.isFinite(frame.tick) ||
    !Number.isFinite(frame.lamportTick) ||
    typeof frame.label !== "string" ||
    !frame.data ||
    typeof frame.data !== "object"
  )
    return null
  return frame as import("../components/live/types/live").LiveEnvelope
}
