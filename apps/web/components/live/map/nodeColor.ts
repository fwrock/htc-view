import type { ActorPlacement, SegmentsTable } from "../types/replay"
import { speedColor } from "./speedColor"

export const UNKNOWN_COLOR: [number, number, number] = [128, 128, 138]
export type NodePalette = Map<string, [number, number, number]>

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)) }
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
}

/** Distinct colour per cluster node: hues evenly spaced over the sorted names, lightness alternating so neighbours differ. */
export function buildNodePalette(nodes: Iterable<string | undefined>): NodePalette {
  const names = [...new Set([...nodes].filter((n): n is string => !!n))].sort()
  const palette: NodePalette = new Map()
  names.forEach((name, i) => palette.set(name, hslToRgb((i * 360) / names.length, 0.75, i % 2 === 0 ? 0.55 : 0.4)))
  return palette
}

export function nodeColor(node?: string, palette?: NodePalette): [number, number, number] {
  if (!node) return UNKNOWN_COLOR
  const known = palette?.get(node)
  if (known) return known
  let hash = 2166136261
  for (const c of node) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619)
  return hslToRgb((hash >>> 0) % 360, 0.75, 0.5)
}

export function allPlacementNodes(index: Map<string, ActorPlacement[]>): string[] {
  const out = new Set<string>()
  for (const history of index.values()) for (const p of history) if (p.node) out.add(p.node)
  return [...out]
}

export function indexPlacements(placements: ActorPlacement[] = []): Map<string, ActorPlacement[]> {
  const index = new Map<string, ActorPlacement[]>()
  for (const p of placements) {
    const id = p.entityId.replace(/[:;]/g, "_")
    const history = index.get(id) ?? []
    if (!index.has(id)) index.set(id, history)
    history.push(p)
  }
  for (const history of index.values()) history.sort((a,b) => a.tick - b.tick)
  return index
}
export function placementAt(index: Map<string, ActorPlacement[]>, id: string, tick: number): string | undefined {
  const history = index.get(id.replace(/[:;]/g, "_"))
  if (!history) return undefined
  let lo = 0, hi = history.length
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (history[mid]!.tick <= tick) lo = mid + 1; else hi = mid }
  return history[lo - 1]?.node
}

/** One speed per active vehicle, choosing the newest segment at shared boundaries. */
export function linkSpeeds(segments: SegmentsTable, tick: number): Map<string, number> {
  const vehicles = new Map<string, number>()
  for (let i = 0; i < segments.length; i++) {
    if (tick < segments.startTick[i]! || tick >= segments.endTick[i]! || !Number.isFinite(segments.speedKmh[i])) continue
    const key = `${segments.vehicleKind[i]}:${segments.vehicleId[i]}`
    const previous = vehicles.get(key)
    if (previous === undefined || segments.startTick[i]! >= segments.startTick[previous]!) vehicles.set(key, i)
  }
  const totals = new Map<string, [number, number]>()
  for (const i of vehicles.values()) {
    const id = segments.linkId[i]!, total = totals.get(id) ?? [0,0]
    total[0] += segments.speedKmh[i]!; total[1]++; totals.set(id, total)
  }
  return new Map([...totals].map(([id,[sum,n]]) => [id,sum/n]))
}
export function linkVelocityColor(speed: number | undefined, freeSpeed: number): [number,number,number] {
  return speed === undefined ? UNKNOWN_COLOR : speedColor(speed, freeSpeed)
}
