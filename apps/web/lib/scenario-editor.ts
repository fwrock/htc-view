export type Entity = {
  id: string
  typeActor: string
  data: { dataType: string; content: Record<string, unknown> }
  dependencies?: Record<string, { id: string; classType: string; relation?: string }>
  [key: string]: unknown
}
export type TransitLine = {
  lineId: string
  stopType: "bus" | "subway"
  headwaySeconds: number
  stops: { stopId: string; travelTimeFromPrevSeconds: number }[]
}
export type TransitStop = { id: string; actorId: string; nodeId: string; stopType: "bus" | "subway"; lines: string[] }
export type EditorDocument = {
  schema: "htc.scenario-draft.v1"
  name: string
  simulation: Record<string, unknown>
  actors: Entity[]
  lines: TransitLine[]
  transit_stops: TransitStop[]
  map_mode: "osm" | "standalone"
  road_network: { links: Record<string, { coordinates: [number, number][]; name?: string; osmWayId: string }> } | null
}
export type Patch = {
  actors?: { id: string; value: Entity | null; at?: number }[]
  lines?: { id: string; value: TransitLine | null; at?: number }[]
  meta?: Partial<Pick<EditorDocument, "name" | "simulation" | "map_mode">>
}
export type Change = { label: string; before: Patch; after: Patch }
export type History = { past: Change[]; future: Change[] }
export type Draft = {
  id: string; base_ref: string; version: number; name: string
  document: EditorDocument; history: History
  published: { ref: string; draft_version: number }[]
}
export type Validation = { ok: boolean; errors: { code: string; message: string; entity_id: string | null }[]; warnings: string[]; base_changed?: boolean; summary?: Record<string, number> }
const base = process.env.NEXT_PUBLIC_SIMEDAPE_API_URL ?? "http://localhost:5000"
export async function editorRequest<T>(path: string, value?: unknown, method = "POST"): Promise<T> {
  const response = await fetch(base + "/api/scenario-editor" + path, value === undefined ? { cache: "no-store" } : {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(value),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? `Editor HTTP ${response.status}`)
  return result as T
}
export const entityKind = (actor: Entity) => actor.typeActor.split(".").pop()!
export const entityName = (actor: Entity) => String(actor.data.content.name ?? actor.data.content.label ?? actor.id)
export function nextIdentity(document: EditorDocument) {
  const occupied = new Set<bigint>()
  function visit(value: unknown) {
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (!value || typeof value !== "object") return
    for (const [key, item] of Object.entries(value)) {
      if (["id", "actorId"].includes(key) && /^-?\d+$/.test(String(item))) occupied.add(BigInt(String(item)))
      else visit(item)
    }
  }
  document.actors.forEach(visit)
  let candidate = [...occupied].reduce((largest, value) => value > largest ? value : largest, 0n) + 1n
  if (candidate >= 2n ** 63n) { candidate = 1n; while (occupied.has(candidate)) candidate++ }
  return candidate.toString()
}
function replace<T>(items: T[], edits: { id: string; value: T | null; at?: number }[], key: (value: T) => string): T[] {
  const replacements = new Map(edits.map((edit) => [edit.id, edit]))
  const result = items.flatMap((item) => {
    const id = key(item)
    if (!replacements.has(id)) return [item]
    const value = replacements.get(id)?.value; replacements.delete(id)
    return value ? [value] : []
  })
  for (const edit of [...replacements.values()].sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity)))
    if (edit.value) result.splice(edit.at ?? result.length, 0, edit.value)
  return result
}
export function applyPatch(document: EditorDocument, patch: Patch): EditorDocument {
  return { ...document, ...patch.meta,
    actors: patch.actors ? replace(document.actors, patch.actors, (actor) => actor.id) : document.actors,
    lines: patch.lines ? replace(document.lines, patch.lines, (line) => line.lineId) : document.lines }
}
export function editDraft(draft: Draft, label: string, after: Patch): Draft {
  const document = draft.document
  const before: Patch = {}
  if (after.actors) before.actors = after.actors.map(({ id }) => ({ id, value: document.actors.find((actor) => actor.id === id) ?? null, at: document.actors.findIndex((actor) => actor.id === id) }))
  if (after.lines) before.lines = after.lines.map(({ id }) => ({ id, value: document.lines.find((line) => line.lineId === id) ?? null, at: document.lines.findIndex((line) => line.lineId === id) }))
  if (after.meta) before.meta = Object.fromEntries(Object.keys(after.meta).map((key) => [key, document[key as keyof typeof after.meta]]))
  const next = applyPatch(document, after)
  if (JSON.stringify(next) === JSON.stringify(document)) return draft
  return { ...draft, document: next, history: { past: [...draft.history.past.slice(-99), { label, before, after }], future: [] } }
}
export function undoDraft(draft: Draft): Draft {
  const change = draft.history.past.at(-1)
  return change ? { ...draft, document: applyPatch(draft.document, change.before), history: {
    past: draft.history.past.slice(0, -1), future: [change, ...draft.history.future] } } : draft
}
export function redoDraft(draft: Draft): Draft {
  const change = draft.history.future[0]
  return change ? { ...draft, document: applyPatch(draft.document, change.after), history: {
    past: [...draft.history.past, change], future: draft.history.future.slice(1) } } : draft
}
export function documentStops(document: EditorDocument): TransitStop[] {
  return document.actors.filter((actor) => ["BusStop", "SubwayStation"].includes(entityKind(actor))).map((actor) => {
    const original = document.transit_stops.find((stop) => stop.actorId === actor.id)
    return { ...original, id: original?.id ?? `editor-stop-${actor.id}`, actorId: actor.id,
      nodeId: String(actor.data.content.nodeId), stopType: entityKind(actor) === "BusStop" ? "bus" : "subway", lines: original?.lines ?? [] }
  })
}
export function replaceSplitRoadReferences(actor: Entity, road: string, second: string, node: string, destination: string): Entity {
  const routeFields = new Set(["bestRoute", "storedBestRoute", "precomputedRoute"])
  function rewrite(value: unknown, field = ""): unknown {
    if (Array.isArray(value)) {
      if (routeFields.has(field)) return value.flatMap((entry) => {
        if (Array.isArray(entry) && String(entry[0]) === road) return [[road, node], [second, destination]]
        if (entry && typeof entry === "object" && String(entry.linkId) === road)
          return [{ ...entry, linkId: road, nodeId: node }, { ...entry, linkId: second, nodeId: destination }]
        return [rewrite(entry)]
      })
      return value.map((entry) => {
        if (field === "phases" && entry && typeof entry === "object" && String(entry.origin) === road) return { ...entry, origin: second }
        return rewrite(entry)
      })
    }
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
      key === "incomingLinkId" && String(item) === road ? second : rewrite(item, key)]))
    return value
  }
  return rewrite(actor) as Entity
}
export function newEntity(kind: string, id: string, document: EditorDocument): Entity {
  const node = document.actors.find((actor) => entityKind(actor) === "Node")
  const origin = node?.id ?? "0"
  const shared = { startTick: 0, scheduleOnTimeManager: true }
  const definitions: Record<string, Record<string, unknown>> = {
    Node: { ...shared, scheduleOnTimeManager: false, latitude: node?.data.content.latitude ?? 0, longitude: node?.data.content.longitude ?? 0, links: [] },
    Link: { ...shared, sidewalk: { enabled: true, width: 1.8, gap: 0.3 }, scheduleOnTimeManager: false, from: origin, to: origin, length: 100, lanes: 1, capacity: 600,
      speedLimit: 30, freeSpeed: 30, currentSpeed: 30, simulationMode: "MESO", microTimeStep: .1, microTicksPerGlobalTick: 10,
      registered: [], vehiclesByLane: {}, laneConfigurations: [{ laneId: 0, type: "normal", width: 3.5, speedLimit: null }] },
    TrafficSignal: { ...shared, cycleDuration: 60, offset: 0, nodes: [origin], phases: [], signalStates: {} },
    BusStop: { nodeId: origin, label: "Nova parada", people: {}, scheduleOnTimeManager: false },
    BusStation: { ...shared, name: "Novo terminal", origin, destination: origin, busStops: {}, interval: 600, buses: [] },
    SubwayStation: { ...shared, name: "Nova estação", nodeId: origin, terminal: false, garage: false, lines: {}, subways: {}, linesRoute: {}, people: {} },
    RailLink: { ...shared, sidewalk: { enabled: true, width: 1.8, gap: 0.3 }, scheduleOnTimeManager: false, from: origin, to: origin, length: 500, lanes: 2, speedLimit: 60,
      capacity: 20, freeSpeed: 60, railType: "SUBWAY", subwayLine: "", fromStation: "0", toStation: "0", simulationMode: "MESO" },
    Car: { ...shared, origin, destination: origin, actorType: "Car", size: 4.5, currentSimulationMode: "MESO", bestRoute: [], distance: 0 },
    Person: { ...shared, originalPlan: [], ownedVehicles: {} },
    Bus: { ...shared, origin, destination: origin, label: "", capacity: 60, numberOfPorts: 2, size: 12, busStops: {}, storedBestRoute: [] },
    Subway: { ...shared, origin, destination: origin, line: "", capacity: 300, numberOfPorts: 4, velocity: 15, stopTime: 15, subwayStations: {} },
    Bicycle: { ...shared, origin, destination: origin, actorType: "Bicycle", size: 1.8, bestRoute: [] },
    Motorcycle: { ...shared, origin, destination: origin, actorType: "Motorcycle", size: 2, bestRoute: [] },
  }
  return { id, typeActor: `hybrid.actor.${kind}`, data: { dataType: `model.hybrid.entity.state.${kind}State`, content: definitions[kind] ?? shared }, dependencies: {} }
}
