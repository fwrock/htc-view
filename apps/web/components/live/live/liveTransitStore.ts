import type { LiveEnvelope } from "../types/live"

export interface TransitVehicleStatus {
  id: string
  kind: "Bus" | "Subway"
  tick: number
  passengers?: number
  capacity?: number
  occupancy?: number
}

export interface TransitLineStatus {
  line: string
  tick: number
  waiting?: number
  arrivals: number
  boarded: number
  vehicleId?: string
  vehicle?: TransitVehicleStatus
}

export interface StopTransitStatus {
  lines: TransitLineStatus[]
  windowStart: number
}

interface Observation {
  tick: number
  order: number
  key: string
  line?: string
  waiting?: number
  arrivals?: number
  boarded?: number
  vehicleKey?: string
  vehicle?: TransitVehicleStatus
}

const id = (value: unknown): string | undefined =>
  typeof value === "string" && value.length ? value :
    typeof value === "number" && Number.isSafeInteger(value) ? String(value) : undefined
const count = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
const ordered = (a: Observation, b: Observation) =>
  a.tick - b.tick || a.order - b.order || a.key.localeCompare(b.key)

/** A bounded event history, shared with the movement WebSocket. Query only the selected
 * stop at the playback tick; station and vehicle topics can arrive in either order. */
export class LiveTransitStore {
  private stops = new Map<string, Observation[]>()
  private vehicles = new Map<string, Observation[]>()
  private seen = new Map<string, number>()
  private latestTick = 0
  private nextPrune = 0
  private simulationId?: string
  private windowTicks: number

  constructor(simulationId?: string, windowTicks = 600) {
    this.simulationId = simulationId
    this.windowTicks = windowTicks
  }

  ingest(env: LiveEnvelope): void {
    if (this.simulationId && env.simulationId !== this.simulationId) return
    if (!Number.isFinite(env.tick) || !Number.isFinite(env.lamportTick)) return
    this.latestTick = Math.max(this.latestTick, env.tick)
    if (env.tick < this.latestTick - this.windowTicks) return
    const d = env.data
    const type = typeof d.event_type === "string" ? d.event_type : env.label
    const stationArrival = type === "passenger_arrived_at_station" || type === "passenger_arrived_at_stop"
    const stationBoarding = type === "passengers_loaded_to_subway" || type === "passengers_loaded"
    const vehicleReport = ["subway_load_passengers", "subway_unload_passengers", "bus_load_passengers", "bus_unload_passengers", "enter_link", "subway_arrival"].includes(type)
    if (!stationArrival && !stationBoarding && !vehicleReport) return
    if (vehicleReport && !id(d.subway_id) && !id(d.bus_id)) return
    const key = JSON.stringify([env.entityId, env.tick, env.lamportTick, env.label,
      Object.keys(d).sort().map((k) => [k, d[k]])])
    if (this.seen.has(key)) return
    this.seen.set(key, env.tick)
    const base: Observation = { tick: env.tick, order: env.lamportTick, key }
    const subway = id(d.subway_id)
    const bus = id(d.bus_id)
    const vehicleKey = subway ? `Subway:${subway}` : bus ? `Bus:${bus}` : undefined

    if (stationArrival || stationBoarding) {
      const stopId = id(d.station_id) ?? id(d.bus_stop_id)
      const line = id(d.line) ?? id(d.route_label)
      if (stopId && line) this.append(this.stops, stopId, {
        ...base, line, waiting: count(d.passengers_waiting),
        arrivals: stationArrival ? 1 : 0,
        boarded: stationBoarding ? count(d.passengers_loaded) : 0,
        vehicleKey: stationBoarding ? vehicleKey : undefined,
      })
    } else if (vehicleReport && vehicleKey) {
      const passengers = count(d.total_passengers) ?? count(d.remaining_passengers) ?? count(d.passengers)
      const capacity = count(d.capacity)
      const occupancy = count(d.occupancy)
      if (passengers !== undefined || capacity !== undefined || occupancy !== undefined)
        this.append(this.vehicles, vehicleKey, {
          ...base, vehicle: { id: (subway ?? bus)!, kind: subway ? "Subway" : "Bus",
            tick: env.tick, passengers, capacity, occupancy },
        })
    }
    if (this.latestTick >= this.nextPrune) {
      this.prune()
      this.nextPrune = this.latestTick + Math.max(1, this.windowTicks / 10)
    }
  }

  private append(map: Map<string, Observation[]>, key: string, value: Observation) {
    const rows = map.get(key) ?? []
    if (!rows.length || ordered(rows[rows.length - 1]!, value) <= 0) rows.push(value)
    else {
      let lo = 0, hi = rows.length
      while (lo < hi) {
        const mid = (lo + hi) >>> 1
        if (ordered(rows[mid]!, value) <= 0) lo = mid + 1
        else hi = mid
      }
      rows.splice(lo, 0, value)
    }
    map.set(key, rows)
  }

  private prune() {
    const cutoff = this.latestTick - this.windowTicks
    for (const [key, tick] of this.seen) if (tick < cutoff) this.seen.delete(key)
    for (const [stop, rows] of this.stops) {
      const baseline = new Map<string, Observation>()
      for (const row of rows) if (row.tick < cutoff) {
        const previous = baseline.get(row.line!)
        baseline.set(row.line!, { ...row, vehicleKey: row.vehicleKey ?? previous?.vehicleKey })
      }
      this.stops.set(stop, [...baseline.values(), ...rows.filter((row) => row.tick >= cutoff)].sort(ordered))
    }
    for (const [key, rows] of this.vehicles) {
      let old: Observation | undefined
      for (const row of rows) if (row.tick < cutoff) {
        old = { ...row, vehicle: { ...old?.vehicle, ...row.vehicle!,
          capacity: row.vehicle?.capacity ?? old?.vehicle?.capacity,
          passengers: row.vehicle?.passengers ?? old?.vehicle?.passengers } }
      }
      const recent = rows.filter((row) => row.tick >= cutoff)
      // Retired vehicles cannot accumulate forever in a long live session.
      if (!recent.length) this.vehicles.delete(key)
      else this.vehicles.set(key, old ? [old, ...recent] : recent)
    }
  }

  stopAt(stopId: string, tick: number): StopTransitStatus | undefined {
    const cutoff = Math.max(0, this.latestTick - this.windowTicks)
    if (tick < cutoff) return undefined
    const windowStart = Math.max(cutoff, tick - this.windowTicks)
    const lines = new Map<string, TransitLineStatus & { vehicleKey?: string }>()
    for (const row of this.stops.get(stopId) ?? []) {
      if (row.tick > tick) break
      const previous = lines.get(row.line!)
      lines.set(row.line!, {
        line: row.line!, tick: row.tick, waiting: row.waiting ?? previous?.waiting,
        arrivals: (previous?.arrivals ?? 0) + (row.tick >= windowStart ? row.arrivals ?? 0 : 0),
        boarded: (previous?.boarded ?? 0) + (row.tick >= windowStart ? row.boarded ?? 0 : 0),
        vehicleKey: row.vehicleKey ?? previous?.vehicleKey,
      })
    }
    for (const line of lines.values()) if (line.vehicleKey) {
      line.vehicleId = line.vehicleKey
      let vehicle: TransitVehicleStatus | undefined
      for (const row of this.vehicles.get(line.vehicleKey) ?? []) {
        if (row.tick > tick) break
        const next = row.vehicle!
        // An unload report updates passengers but must not retain an old occupancy ratio.
        vehicle = { ...vehicle, ...next, capacity: next.capacity ?? vehicle?.capacity,
          passengers: next.passengers ?? vehicle?.passengers }
        if (vehicle.passengers !== undefined && vehicle.capacity && vehicle.capacity > 0)
          vehicle.occupancy = vehicle.passengers / vehicle.capacity * 100
      }
      line.vehicle = vehicle
    }
    return lines.size ? { lines: [...lines.values()].sort((a, b) => a.line.localeCompare(b.line)), windowStart } : undefined
  }
}
