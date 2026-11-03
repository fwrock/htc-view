import type { SegmentsTable } from "../types/replay"
import type { LiveEnvelope } from "../types/live"
import {
  buildLinkGeometryLookup,
  buildNodePointLookup,
  type LinkGeometry,
  type NodePoint,
} from "./geometryLookup"
import type { LinksTable, NodesTable, RailLinksTable } from "../types/replay"

interface MutableSegment {
  startLane?: number
  endLane?: number
  vehicleId: string
  vehicleKind: string
  linkId: string
  startTick: number
  endTick: number
  lat0: number
  lon0: number
  lat1: number
  lon1: number
  startFrac: number
  endFrac: number
  speedKmh: number
}

interface OpenSegment extends MutableSegment {
  /** Provisional segments haven't been confirmed by a real leave/update event yet — see
   * docs/ARCHITECTURE.md discussion on MESO's provisional-end projection. Kept only for
   * bookkeeping; both provisional and confirmed open segments render identically. */
  provisional: boolean
}

function num(data: Record<string, unknown>, key: string): number | undefined {
  const v = data[key]
  return typeof v === "number" ? v : undefined
}

function str(data: Record<string, unknown>, key: string): string | undefined {
  const v = data[key]
  return typeof v === "string" ? v : undefined
}

/** Live reports can encode actor, link and node IDs as strings or JSON integers.
 * Normalize both to the keys used by geometry and segment lookups, rejecting unsafe
 * numeric IDs whose original precision has already been lost during JSON decoding. */
function idStr(data: Record<string, unknown>, key: string): string | undefined {
  const v = data[key]
  if (typeof v === "string") return v
  if (typeof v === "number")
    return Number.isSafeInteger(v) ? v.toString() : undefined
  return undefined
}

/** `vehicle_id`/`vehicle_kind` extraction — mirrors the ETL's rule exactly (see
 * docs/ETL_SCHEMA.md `segments.arrow` column table): whichever `<kind>_id` field is present,
 * falling back to `entityId` with an "Unknown" kind. */
function identifyVehicle(env: LiveEnvelope): {
  vehicleId: string
  vehicleKind: string
} {
  const data = env.data
  if (idStr(data, "car_id"))
    return { vehicleId: idStr(data, "car_id")!, vehicleKind: "Car" }
  if (idStr(data, "bus_id"))
    return { vehicleId: idStr(data, "bus_id")!, vehicleKind: "Bus" }
  if (idStr(data, "subway_id"))
    return { vehicleId: idStr(data, "subway_id")!, vehicleKind: "Subway" }
  if (idStr(data, "motorcycle_id"))
    return { vehicleId: idStr(data, "motorcycle_id")!, vehicleKind: "Motorcycle" }
  if (idStr(data, "bicycle_id"))
    return { vehicleId: idStr(data, "bicycle_id")!, vehicleKind: "Bicycle" }
  if (idStr(data, "person_id"))
    return { vehicleId: idStr(data, "person_id")!, vehicleKind: "Person" }
  return { vehicleId: env.entityId, vehicleKind: "Unknown" }
}

/** Builds and incrementally updates a `SegmentsTable`-shaped snapshot from a live WebSocket
 * stream of `LiveEnvelope`s, applying the same MESO/MICRO/walking derivation rules as the
 * batch ETL (docs/ETL_SCHEMA.md) — the difference is *when* each rule can fire, not what it
 * computes:
 *
 * - MESO: `enter_link` opens a segment with a provisional end projected from `travel_time`
 *   (the same fallback formula the ETL uses for a trip truncated at simulation end — here it's
 *   the normal case, not the edge case, since live segments are *always* open until their
 *   `leave_link` arrives). `leave_link` closes it for real (`end_frac = 1`).
 * - MICRO: no batch-style reconstruction is possible (the ETL only knows a MICRO segment
 *   happened *after* `leave_micro_link`, by working backwards — see ETL_SCHEMA.md). Live mode
 *   instead chains one short segment per throttled `micro_update` (see
 *   `htc.report-manager.kafka.micro-update-report-every` in the engine), each one closing the
 *   previous point and opening the next, until `leave_micro_link` closes the last one.
 * - Person walking: `person_walking_start` already carries a precomputed `arrival_tick`, so
 *   (like the ETL) the whole leg is emitted as one already-closed segment, no open/close
 *   bookkeeping needed.
 *
 * `snapshot()` is intentionally *not* called on every single envelope — see `useLiveSegments`,
 * which throttles snapshot rebuilds. This class only maintains the mutable row buffers.
 */
/** Default sliding-window size for closed segments, in ticks (~10 minutes at the common
 * 1-tick-per-simulated-second convention). A live session has no `tickMax` and can run for
 * hours — unlike file replay, which can afford to hold every segment because the whole file
 * is already bounded and known — so old segments are dropped once they're this far behind the
 * live edge, not just left to accumulate. See project memory on htc-replay live mode: this is
 * the "live edge + finite trailing window" model decided early on, distinct from replay's
 * "load the whole bounded file" model. */
const DEFAULT_WINDOW_TICKS = 600

/** How many closed segments to hold before pruning — pruning is O(n) so it's batched rather
 * than done on every single `ingest()` call. */
const PRUNE_CHECK_INTERVAL = 500

export class LiveSegmentStore {
  private readonly linkGeometry: Map<string, LinkGeometry>
  private readonly nodePoints: Map<string, NodePoint>
  private readonly ticksPerSecond: number
  private readonly windowTicks: number
  private readonly simulationId?: string

  private closed: MutableSegment[] = []
  private readonly open = new Map<string, OpenSegment>()
  private latestTick = 0
  private readonly lastMotion = new Map<string, [number, number, number]>()
  private ingestedSincePrune = 0

  constructor(
    links: LinksTable,
    nodes: NodesTable,
    ticksPerSecond: number,
    windowTicks: number = DEFAULT_WINDOW_TICKS,
    simulationId?: string,
    railLinks?: RailLinksTable
  ) {
    this.simulationId = simulationId
    this.linkGeometry = buildLinkGeometryLookup(links)
    if (railLinks)
      for (const [id, geometry] of buildLinkGeometryLookup(railLinks))
        this.linkGeometry.set(id, geometry)
    this.nodePoints = buildNodePointLookup(nodes)
    this.ticksPerSecond = ticksPerSecond > 0 ? ticksPerSecond : 1
    this.windowTicks = windowTicks
  }

  getLatestTick(): number {
    return this.latestTick
  }

  ingest(env: LiveEnvelope): void {
    if (this.simulationId && env.simulationId !== this.simulationId) return
    const eventType = str(env.data, "event_type") ?? env.label
    // Position events may arrive from different Kafka topics. Never let a delayed update
    // reopen a vehicle after its later leave, or replace a newer position with an older one.
    if (
      [
        "enter_link",
        "leave_link",
        "enter_micro_link",
        "micro_update",
        "leave_micro_link",
        "walking_trip_start",
      ].includes(eventType)
    ) {
      if (env.tick < this.latestTick - this.windowTicks) return
      const key = identifyVehicle(env).vehicleId
      const order: [number, number, number] = [
        env.tick,
        env.lamportTick,
        num(env.data, "sub_tick") ?? 0,
      ]
      const previous = this.lastMotion.get(key)
      if (
        previous &&
        (order[0] < previous[0] ||
          (order[0] === previous[0] &&
            (order[1] < previous[1] ||
              (order[1] === previous[1] && order[2] < previous[2]))))
      )
        return
      this.lastMotion.set(key, order)
    }
    this.latestTick = Math.max(this.latestTick, env.tick)
    switch (eventType) {
      case "enter_link":
        this.onEnterLinkMeso(env)
        break
      case "leave_link":
        this.onLeaveLinkMeso(env)
        break
      case "enter_micro_link":
        this.onEnterMicroLink(env)
        break
      case "micro_update":
        this.onMicroUpdate(env)
        break
      case "leave_micro_link":
        this.onLeaveMicroLink(env)
        break
      case "walking_trip_start":
        this.onWalkingTripStart(env)
        break
      default:
      // Every other label (signal changes, journey-summary metrics, sumo_summary_step, ...)
      // is simulation telemetry irrelevant to vehicle position — the same ~90%+-of-rows
      // noise the batch ETL filters out (docs/ETL_SCHEMA.md). Silently ignored here too.
    }

    this.ingestedSincePrune += 1
    if (this.ingestedSincePrune >= PRUNE_CHECK_INTERVAL) {
      this.ingestedSincePrune = 0
      this.pruneOld()
    }
  }

  private pruneOld(): void {
    const cutoff = this.latestTick - this.windowTicks
    if (cutoff <= 0) return
    this.closed = this.closed.filter((s) => s.endTick >= cutoff)
    for (const [identity, order] of this.lastMotion) {
      if (order[0] < cutoff && !this.open.has(identity))
        this.lastMotion.delete(identity)
    }
  }

  private onEnterLinkMeso(env: LiveEnvelope): void {
    const { vehicleId, vehicleKind } = identifyVehicle(env)
    const linkId = idStr(env.data, "link_id")
    if (!linkId) return
    const geometry = this.linkGeometry.get(linkId)
    if (!geometry) return // link not in this scenario's static geometry — nothing to draw

    // Defensive: a missed leave_link would otherwise leak this vehicle's previous open
    // segment forever. Close it out at the new enter's tick rather than losing the vehicle.
    this.closeIfOpen(vehicleId, env.tick, 1)

    const travelTimeSeconds = num(env.data, "travel_time") ?? 0
    const speedKmh =
      num(env.data, "calculated_speed") ??
      num(env.data, "speed") ??
      geometry.freeSpeedKmh
    const provisionalEndTick =
      env.tick +
      Math.max(1, Math.round(travelTimeSeconds * this.ticksPerSecond))

    this.open.set(vehicleId, {
      vehicleId,
      vehicleKind,
      linkId,
      startTick: env.tick,
      endTick: provisionalEndTick,
      lat0: geometry.lat0,
      lon0: geometry.lon0,
      lat1: geometry.lat1,
      lon1: geometry.lon1,
      startFrac: 0,
      endFrac: 1,
      speedKmh,
      provisional: true,
    })
  }

  private onLeaveLinkMeso(env: LiveEnvelope): void {
    const { vehicleId } = identifyVehicle(env)
    this.closeIfOpen(vehicleId, env.tick, 1)
  }

  private onEnterMicroLink(env: LiveEnvelope): void {
    const { vehicleId, vehicleKind } = identifyVehicle(env)
    const linkId = idStr(env.data, "link_id")
    if (!linkId) return
    const geometry = this.linkGeometry.get(linkId)
    if (!geometry) return

    this.closeIfOpen(vehicleId, env.tick, 0)

    // Degenerate placeholder segment anchored at the link entry point — replaced the moment
    // the first micro_update (or leave_micro_link, if it arrives first) closes it out.
    this.open.set(vehicleId, {
      vehicleId,
      vehicleKind,
      linkId,
      startTick: env.tick,
      endTick: env.tick + 1,
      lat0: geometry.lat0,
      lon0: geometry.lon0,
      lat1: geometry.lat1,
      lon1: geometry.lon1,
      startFrac: clamp01(
        (num(env.data, "initial_position") ?? 0) / Math.max(1, geometry.lengthM)
      ),
      endFrac: clamp01(
        (num(env.data, "initial_position") ?? 0) / Math.max(1, geometry.lengthM)
      ),
      startLane: reportedLane(env.data),
      endLane: reportedLane(env.data),
      speedKmh:
        num(env.data, "initial_velocity") != null
          ? num(env.data, "initial_velocity")! * 3.6
          : geometry.freeSpeedKmh,
      provisional: true,
    })
  }

  private onMicroUpdate(env: LiveEnvelope): void {
    const { vehicleId, vehicleKind } = identifyVehicle(env)
    const linkId = idStr(env.data, "link_id")
    const position = num(env.data, "position")
    if (!linkId || position == null) return
    const geometry = this.linkGeometry.get(linkId)
    if (!geometry || geometry.lengthM <= 0) return

    const frac = clamp01(position / geometry.lengthM)
    const velocityMs = num(env.data, "velocity") ?? 0

    const existing = this.open.get(vehicleId)
    const lane =
      reportedLane(env.data) ??
      (existing?.linkId === linkId ? existing.endLane : undefined)
    const startTick =
      existing && existing.linkId === linkId ? existing.startTick : env.tick
    const startFrac =
      existing && existing.linkId === linkId ? existing.startFrac : frac

    // Close out the previous point-to-point sub-segment for real, then open the next one
    // anchored at this update — the "one short segment per sub-tick update" chain described
    // in this class's docstring.
    if (existing && existing.linkId === linkId) {
      this.closed.push({
        vehicleId,
        vehicleKind,
        linkId,
        startTick: existing.startTick,
        endTick: Math.max(env.tick, existing.startTick + 1),
        lat0: geometry.lat0,
        lon0: geometry.lon0,
        lat1: geometry.lat1,
        lon1: geometry.lon1,
        startFrac: existing.startFrac,
        endFrac: frac,
        startLane: existing.startLane,
        endLane: lane,
        speedKmh: velocityMs * 3.6,
      })
    }

    this.open.set(vehicleId, {
      vehicleId,
      vehicleKind,
      linkId,
      startTick: env.tick,
      // Provisional lookahead so the vehicle keeps drifting forward between updates instead
      // of freezing at the last known point — overwritten by the next micro_update/leave.
      endTick: env.tick + 5,
      lat0: geometry.lat0,
      lon0: geometry.lon0,
      lat1: geometry.lat1,
      lon1: geometry.lon1,
      startFrac: frac,
      startLane: lane,
      endLane: lane,
      endFrac: clamp01(
        frac + (velocityMs * 5) / (geometry.lengthM * this.ticksPerSecond)
      ),
      speedKmh: velocityMs * 3.6,
      provisional: true,
    })
    // startTick/startFrac captured above intentionally unused beyond the closed-push branch —
    // kept as locals for readability of what "the previous anchor" means in this method.
    void startTick
    void startFrac
  }

  private onLeaveMicroLink(env: LiveEnvelope): void {
    const { vehicleId, vehicleKind } = identifyVehicle(env)
    const linkId = idStr(env.data, "link_id")
    const finalPosition = num(env.data, "final_position")
    if (!linkId) return
    const geometry = this.linkGeometry.get(linkId)
    const existing = this.open.get(vehicleId)
    if (!existing || existing.linkId !== linkId) return

    const endFrac =
      geometry && finalPosition != null
        ? clamp01(finalPosition / Math.max(1, geometry.lengthM))
        : 1
    this.closed.push({
      vehicleId,
      vehicleKind,
      linkId,
      startTick: existing.startTick,
      endTick: Math.max(env.tick, existing.startTick + 1),
      lat0: existing.lat0,
      lon0: existing.lon0,
      lat1: existing.lat1,
      lon1: existing.lon1,
      startFrac: existing.startFrac,
      startLane: existing.startLane,
      endLane: existing.endLane,
      endFrac,
      speedKmh: existing.speedKmh,
    })
    this.open.delete(vehicleId)
  }

  private onWalkingTripStart(env: LiveEnvelope): void {
    const { vehicleId, vehicleKind } = identifyVehicle(env)
    const origin = idStr(env.data, "origin")
    const destination = idStr(env.data, "destination")
    const arrivalTick = num(env.data, "arrival_tick")
    if (!origin || !destination || arrivalTick == null) return
    const originPoint = this.nodePoints.get(origin)
    const destPoint = this.nodePoints.get(destination)
    if (!originPoint || !destPoint) return

    const walkingSpeedMs = num(env.data, "walking_speed")
    this.closed.push({
      vehicleId,
      vehicleKind,
      linkId: `walk:${origin}:${destination}`,
      startTick: env.tick,
      endTick: Math.max(arrivalTick, env.tick + 1),
      lat0: originPoint.lat,
      lon0: originPoint.lon,
      lat1: destPoint.lat,
      lon1: destPoint.lon,
      startFrac: 0,
      endFrac: 1,
      speedKmh: walkingSpeedMs != null ? walkingSpeedMs * 3.6 : Number.NaN,
    })
  }

  private closeIfOpen(
    vehicleId: string,
    atTick: number,
    endFrac: number
  ): void {
    const existing = this.open.get(vehicleId)
    if (!existing) return
    this.closed.push({
      vehicleId: existing.vehicleId,
      vehicleKind: existing.vehicleKind,
      linkId: existing.linkId,
      startTick: existing.startTick,
      endTick: Math.max(atTick, existing.startTick + 1),
      lat0: existing.lat0,
      lon0: existing.lon0,
      lat1: existing.lat1,
      lon1: existing.lon1,
      startFrac: existing.startFrac,
      startLane: existing.startLane,
      endLane: existing.endLane,
      endFrac,
      speedKmh: existing.speedKmh,
    })
    this.open.delete(vehicleId)
  }

  /** Materializes a `SegmentsTable` snapshot — closed segments plus every currently-open one
   * (rendered with its provisional end) so an in-flight vehicle is always visible, not just
   * ones whose current link traversal has already finished.
   */
  snapshot(): SegmentsTable {
    const rows: MutableSegment[] = [...this.closed, ...this.open.values()]
    const length = rows.length

    const vehicleId = new Array<string>(length)
    const vehicleKind = new Array<string>(length)
    const linkId = new Array<string>(length)
    const startTick = new Float64Array(length)
    const endTick = new Float64Array(length)
    const lat0 = new Float32Array(length)
    const lon0 = new Float32Array(length)
    const lat1 = new Float32Array(length)
    const lon1 = new Float32Array(length)
    const startLane = new Float32Array(length).fill(NaN)
    const endLane = new Float32Array(length).fill(NaN)
    const startFrac = new Float32Array(length)
    const endFrac = new Float32Array(length)
    const speedKmh = new Float32Array(length)
    // Emissions aren't part of the live tap yet (see project notes) — nullable columns are
    // left as NaN, matching how `loadFrames.ts` represents "absent" emission values.
    const co2Grams = new Float32Array(length).fill(NaN)
    const noxGrams = new Float32Array(length).fill(NaN)
    const pm25Grams = new Float32Array(length).fill(NaN)

    rows.forEach((row, i) => {
      vehicleId[i] = row.vehicleId
      vehicleKind[i] = row.vehicleKind
      linkId[i] = row.linkId
      startTick[i] = row.startTick
      endTick[i] = row.endTick
      lat0[i] = row.lat0
      lon0[i] = row.lon0
      lat1[i] = row.lat1
      lon1[i] = row.lon1
      startLane[i] = row.startLane ?? NaN
      endLane[i] = row.endLane ?? NaN
      startFrac[i] = row.startFrac
      endFrac[i] = row.endFrac
      speedKmh[i] = row.speedKmh
    })

    return {
      length,
      vehicleId,
      vehicleKind,
      linkId,
      startTick,
      endTick,
      lat0,
      lon0,
      lat1,
      lon1,
      startLane,
      endLane,
      startFrac,
      endFrac,
      speedKmh,
      co2Grams,
      noxGrams,
      pm25Grams,
    }
  }
}

function clamp01(v: number): number {
  if (v < 0) return 0
  if (v > 1) return 1
  return v
}

function reportedLane(data: Record<string, unknown>): number | undefined {
  const lane = num(data, "lane")
  return lane !== undefined && Number.isInteger(lane) && lane >= 0
    ? lane
    : undefined
}
