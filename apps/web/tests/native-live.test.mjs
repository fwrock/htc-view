import test from "node:test"
import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import path from "node:path"
registerHooks({
  resolve(specifier, context, next) {
    return next(
      specifier.startsWith(".") && !path.extname(specifier)
        ? specifier + ".ts"
        : specifier,
      context
    )
  },
})
const { decodeLiveGeometry, parseStreamFrame } =
  await import("../lib/native-live.ts")
const { LiveSegmentStore } =
  await import("../components/live/live/liveSegmentStore.ts")

const raw = {
  schema: "htc.live-geometry.v1",
  run_id: "run-a",
  scenario_sha256: "hash",
  nodes: [
    { id: "9007199254740993", lat: 48, lon: 2, has_signal: false },
    { id: "2", lat: 48.001, lon: 2, has_signal: false },
  ],
  links: [
    {
      id: "17",
      from: "9007199254740993",
      to: "2",
      length_m: 100,
      lanes: 1,
      free_speed_kmh: 36,
      simulation_mode: "MICRO",
    },
  ],
  signals: [],
  road_network: null,
  tick_min: 0,
  tick_max: 100,
  ticks_per_second: 1,
  bounds: { minLat: 48, maxLat: 48.001, minLon: 2, maxLon: 2 },
}
const event = (label, tick, lamportTick, data = {}) => ({
  simulationId: "run-a",
  entityId: "car",
  tick,
  lamportTick,
  label,
  data: { event_type: label, car_id: "car", link_id: "17", ...data },
})

test("live geometry retains string identities and rejects other runs or missing endpoints", () => {
  const geometry = decodeLiveGeometry(structuredClone(raw), "run-a")
  assert.equal(geometry.nodes.nodeId[0], "9007199254740993")
  assert.throws(() => decodeLiveGeometry(raw, "run-b"), /different/)
  assert.throws(
    () => decodeLiveGeometry({ ...raw, nodes: [] }, "run-a"),
    /Invalid/
  )
  assert.throws(
    () =>
      decodeLiveGeometry(
        { ...raw, nodes: [raw.nodes[0], raw.nodes[0]] },
        "run-a"
      ),
    /Invalid/
  )
  assert.throws(
    () => decodeLiveGeometry({ ...raw, ticks_per_second: 0 }, "run-a"),
    /clock/
  )
})

test("protocol filters foreign events and readiness frames", () => {
  const own = event("enter_micro_link", 0, 1)
  assert.deepEqual(parseStreamFrame(JSON.stringify(own), "run-a"), own)
  assert.equal(parseStreamFrame(JSON.stringify(own), "run-b"), null)
  const ready = {
    type: "stream_ready",
    protocol: "htc.live.v1",
    simulation_id: "run-a",
    connection_id: "session",
    bridge_id: "bridge",
  }
  assert.deepEqual(parseStreamFrame(JSON.stringify(ready), "run-a"), ready)
  assert.equal(parseStreamFrame(JSON.stringify(ready), "run-b"), null)
  assert.equal(
    parseStreamFrame(JSON.stringify({ ...ready, protocol: "old" }), "run-a"),
    null
  )
})

test("a scoped store ignores foreign ticks before any state mutation", () => {
  const { links, nodes } = decodeLiveGeometry(raw, "run-a")
  const store = new LiveSegmentStore(links, nodes, 1, 600, "run-a")
  store.ingest({ ...event("enter_micro_link", 999, 1), simulationId: "run-b" })
  assert.equal(store.getLatestTick(), 0)
  assert.equal(store.snapshot().length, 0)
})

test("MESO opens provisionally and closes at the actual exit without MICRO samples", () => {
  const meso = structuredClone(raw)
  meso.links[0].simulation_mode = "MESO"
  const { links, nodes } = decodeLiveGeometry(meso, "run-a")
  const store = new LiveSegmentStore(links, nodes, 1, 600, "run-a")
  store.ingest(event("enter_link", 2, 1, { travel_time: 10, calculated_speed: 36 }))
  let snapshot = store.snapshot()
  assert.equal(snapshot.length, 1)
  assert.equal(snapshot.startTick[0], 2)
  assert.equal(snapshot.endTick[0], 12)
  store.ingest(event("leave_link", 14, 2))
  snapshot = store.snapshot()
  assert.equal(snapshot.length, 1)
  assert.equal(snapshot.endTick[0], 14)
  store.ingest(event("enter_link", 2, 1, { travel_time: 10 }))
  assert.equal(store.snapshot().length, 1, "A delayed MESO entry must not reopen the trip")
})

test("late MICRO updates cannot reopen a vehicle after a newer leave", () => {
  const { links, nodes } = decodeLiveGeometry(raw, "run-a")
  const store = new LiveSegmentStore(links, nodes, 1, 600, "run-a")
  store.ingest(event("enter_micro_link", 0, 1))
  store.ingest(
    event("micro_update", 2, 2, { position: 50, velocity: 10, sub_tick: 1 })
  )
  store.ingest(event("leave_micro_link", 3, 3, { final_position: 100 }))
  const before = store.snapshot()
  store.ingest(
    event("micro_update", 2, 2, { position: 40, velocity: 10, sub_tick: 0 })
  )
  const after = store.snapshot()
  assert.deepEqual(after, before)
  assert.equal(store.getLatestTick(), 3)
})

test("HTC 3.9 bridge frames preserve large actor IDs and vehicle kind in live motion", () => {
  const { links, nodes } = decodeLiveGeometry(raw, "run-a")
  const store = new LiveSegmentStore(links, nodes, 1, 600, "run-a")
  const identity = "9007199254740993"
  const frame = (label, tick, fields) => parseStreamFrame(JSON.stringify({
    simulationId: "run-a", entityId: identity, node: "node-1",
    tick, lamportTick: tick + 1, label,
    data: { car_id: identity, link_id: "17", ...fields },
  }), "run-a")
  store.ingest(frame("enter_micro_link", 0, { initial_position: 0, initial_velocity: 10 }))
  store.ingest(frame("micro_update", 1, { position: 10, velocity: 10 }))
  store.ingest(frame("leave_micro_link", 2, { final_position: 100, final_velocity: 10 }))
  const segments = store.snapshot()
  assert(segments.length > 0)
  assert(segments.vehicleId.every(id => id === identity))
  assert(segments.vehicleKind.every(kind => kind === "Car"))
})
