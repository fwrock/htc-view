import test from "node:test"
import assert from "node:assert/strict"
import { LiveTransitStore } from "../components/live/live/liveTransitStore.ts"

const frame = (tick, event_type, data, extra = {}) => ({
  simulationId: "run", entityId: "source", tick, lamportTick: tick,
  label: event_type, data: { event_type, ...data }, ...extra,
})

test("subway panel joins station and vehicle topics in either order at the playback tick", () => {
  const store = new LiveTransitStore("run")
  store.ingest(frame(20, "subway_load_passengers", { subway_id: 7, total_passengers: 80, capacity: 200 }))
  store.ingest(frame(20, "passengers_loaded_to_subway", { station_id: 1, line: "L1", subway_id: 7, passengers_loaded: 20, passengers_waiting: 3 }))
  store.ingest(frame(10, "passenger_arrived_at_station", { station_id: 1, line: "L1", passengers_waiting: 23 }))
  assert.equal(store.stopAt("1", 9), undefined)
  const early = store.stopAt("1", 15).lines[0]
  assert.equal(early.waiting, 23)
  assert.equal(early.vehicle, undefined)
  const now = store.stopAt("1", 20).lines[0]
  assert.equal(now.waiting, 3)
  assert.equal(now.boarded, 20)
  assert.equal(now.vehicle.id, "7")
  assert.equal(now.vehicle.occupancy, 40)
  store.ingest(frame(25, "subway_unload_passengers", { subway_id: 7, remaining_passengers: 60 }))
  assert.equal(store.stopAt("1", 25).lines[0].vehicle.occupancy, 30)
  assert.equal(store.stopAt("1", 20).lines[0].vehicle.occupancy, 40)
})

test("stop and line queues stay separate, duplicates do not inflate received boardings", () => {
  const store = new LiveTransitStore("run")
  for (const [station, line, waiting] of [[1, "A", 8], [1, "B", 4], [2, "A", 9]])
    store.ingest(frame(10, "passenger_arrived_at_station", { station_id: station, line, passengers_waiting: waiting }))
  const boarding = frame(12, "passengers_loaded_to_subway", { station_id: 1, line: "A", subway_id: "train", passengers_loaded: 3, passengers_waiting: 5 })
  store.ingest(boarding)
  store.ingest(boarding)
  assert.deepEqual(store.stopAt("1", 12).lines.map((line) => [line.line, line.waiting, line.boarded]), [["A", 5, 3], ["B", 4, 0]])
  assert.equal(store.stopAt("2", 12).lines[0].waiting, 9)
  store.ingest(frame(13, "passenger_arrived_at_station", { station_id: 1, line: "A", passengers_waiting: 99 }, { simulationId: "foreign" }))
  assert.equal(store.stopAt("1", 13).lines[0].waiting, 5)
})

test("bus occupancy uses reported values and an unload clears an otherwise stale percentage", () => {
  const store = new LiveTransitStore("run")
  store.ingest(frame(10, "passengers_loaded", { bus_stop_id: "stop", route_label: "B1", bus_id: "bus", passengers_loaded: 2, passengers_waiting: 0 }))
  store.ingest(frame(10, "bus_load_passengers", { bus_id: "bus", total_passengers: 10, occupancy: 25 }))
  const line = store.stopAt("stop", 10).lines[0]
  assert.equal(line.waiting, 0)
  assert.equal(line.vehicle.occupancy, 25)
  assert.equal(line.vehicle.capacity, undefined)
  store.ingest(frame(15, "bus_unload_passengers", { bus_id: "bus", remaining_passengers: 5 }))
  assert.equal(store.stopAt("stop", 15).lines[0].vehicle.passengers, 5)
  assert.equal(store.stopAt("stop", 15).lines[0].vehicle.occupancy, undefined)
})

test("retention preserves queue baselines but rejects rewind outside history and ages out window counts", () => {
  const store = new LiveTransitStore("run", 10)
  store.ingest(frame(1, "passengers_loaded", { bus_stop_id: "stop", route_label: "B1", bus_id: "bus", passengers_loaded: 4, passengers_waiting: 0 }))
  store.ingest(frame(20, "passenger_arrived_at_stop", { bus_stop_id: "other", route_label: "B2", passengers_waiting: 1 }))
  assert.equal(store.stopAt("stop", 1), undefined)
  const baseline = store.stopAt("stop", 20).lines[0]
  assert.equal(baseline.waiting, 0)
  assert.equal(baseline.boarded, 0)
  assert.equal(baseline.tick, 1)
  assert.equal(baseline.vehicle, undefined)
})

test("missing or invalid values remain unknown rather than fabricated zeroes", () => {
  const store = new LiveTransitStore("run")
  store.ingest(frame(1, "passenger_arrived_at_stop", { bus_stop_id: "s", route_label: "B", passengers_waiting: -1 }))
  assert.equal(store.stopAt("s", 1).lines[0].waiting, undefined)
  assert.equal(store.stopAt("never-seen", 1), undefined)
})
