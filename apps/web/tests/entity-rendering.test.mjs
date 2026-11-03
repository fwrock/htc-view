import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"

// The viewer uses bundler-style extensionless imports; let Node's TS runner resolve them.
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context)
    } catch (error) {
      if (
        error.code === "ERR_MODULE_NOT_FOUND" &&
        specifier.startsWith(".") &&
        context.parentURL?.includes("/components/live/")
      )
        return next(`${specifier}.ts`, context)
      throw error
    }
  },
})

const { vehicleSprite, signalSprite, VEHICLE_DIMENSIONS } =
  await import("../components/live/map/entitySprites.ts")
const { entityAngle } = await import("../components/live/map/entityGeometry.ts")
const { createVehicleSpriteLayer } =
  await import("../components/live/map/layers/vehicleSpriteLayer.ts")
const { buildSignalMarkers, createSignalSpriteLayer, signalAppearance } =
  await import("../components/live/map/layers/signalSpriteLayer.ts")
const { computeVehiclePositions } =
  await import("../components/live/map/layers/vehicleScatterLayer.ts")
const { indexRoad, directionOnRoad } =
  await import("../components/live/map/roadGeometry.ts")
const { buildPositionBuffers, createLinkLayerBinary } =
  await import("../components/live/map/layers/linkLayer.ts")
const { LiveSegmentStore } =
  await import("../components/live/live/liveSegmentStore.ts")
const { laneMarkings: microLaneMarkings } =
  await import("../components/live/map/laneGeometry.ts")

function fixture() {
  const links = {
    length: 2,
    linkId: ["west", "south"],
    lon0: new Float32Array([1.999, 2]),
    lat0: new Float32Array([48, 47.999]),
    lon1: new Float32Array([2, 2]),
    lat1: new Float32Array([48, 48]),
    lanes: new Int32Array([1, 2]),
    lengthM: new Float32Array([74, 111]),
    simulationMode: ["MICRO", "MICRO"],
    freeSpeedKmh: new Float32Array([30, 30]),
  }
  const nodes = {
    length: 2,
    nodeId: ["intersection", "unconfigured"],
    lon: new Float32Array([2, 2.001]),
    lat: new Float32Array([48, 48]),
    hasSignal: new Int32Array([1, 1]),
  }
  const signal = {
    signalId: "lights",
    nodeIds: ["intersection"],
    startTick: 10,
    cycleDuration: 60,
    offset: 5,
    phases: [
      { origin: "west", greenStartTick: 0, greenDurationTick: 30 },
      { origin: "south", greenStartTick: 30, greenDurationTick: 30 },
    ],
  }
  return { links, nodes, signal }
}

test("each transport has a cached SVG, physical dimensions and distinct speed appearances", () => {
  const kinds = ["Car", "Bus", "Subway", "Motorcycle", "Bicycle", "Person"]
  assert.equal(
    new Set(kinds.map((kind) => vehicleSprite(kind, "flowing").url)).size,
    kinds.length
  )
  for (const kind of kinds) {
    const stopped = vehicleSprite(kind, "stopped"),
      flowing = vehicleSprite(kind, "flowing")
    assert.notEqual(stopped.url, flowing.url)
    assert.equal(vehicleSprite(kind, "flowing"), flowing)
    assert.ok(
      decodeURIComponent(flowing.url).includes(
        '<svg xmlns="http://www.w3.org/2000/svg"'
      )
    )
    assert.ok(
      Math.abs(
        flowing.width / flowing.height -
          VEHICLE_DIMENSIONS[kind].width / VEHICLE_DIMENSIONS[kind].length
      ) < 0.004
    )
  }
  assert.equal(
    vehicleSprite("new-kind", "slow"),
    vehicleSprite("Unknown", "slow")
  )
  assert.notEqual(signalSprite("Green").url, signalSprite("Red").url)
})

test("roads use lane widths and sprites use metres without a pixel-size floor or ceiling", () => {
  const { links } = fixture()
  const layer = createLinkLayerBinary(links, buildPositionBuffers(links), null)
  assert.equal(layer.props.widthUnits, "meters")
  assert.ok(
    Math.abs(layer.props.data.attributes.getWidth.value[0] - 3.2) < 1e-6
  )
  assert.ok(
    Math.abs(layer.props.data.attributes.getWidth.value[1] - 6.4) < 1e-6
  )
  const sprites = createVehicleSpriteLayer([])
  assert.equal(sprites.props.sizeUnits, "meters")
  assert.equal(sprites.props.sizeMinPixels, 0)
  assert.ok(sprites.props.sizeMaxPixels > 10000)
  assert.equal(sprites.props.billboard, false)
  assert.equal(sprites.props.getSize({ vehicleKind: "Bus" }), 12)
  const datum = {
    vehicleKind: "Car",
    speedKmh: 5,
    freeSpeedKmh: 50,
    angle: -90,
  }
  assert.equal(sprites.props.getAngle(datum), -90)
  assert.notEqual(
    sprites.props.getIcon(datum).url,
    sprites.props.getIcon({ ...datum, speedKmh: 50 }).url
  )
})

test("vehicle headings follow cardinal directions, actual road bends and reverse travel", () => {
  assert.ok(Math.abs(entityAngle([2, 48], [2, 49])) < 1e-6)
  assert.equal(entityAngle([2, 48], [3, 48]), -90)
  assert.equal(entityAngle([2, 48], [1, 48]), 90)
  const road = indexRoad({
    coordinates: [
      [2, 48],
      [2.001, 48],
      [2.001, 48.001],
    ],
  })
  assert.equal(directionOnRoad(road, 0), -90)
  assert.ok(Math.abs(directionOnRoad(road, 1)) < 1e-6)
  const segments = {
    length: 1,
    vehicleId: ["car"],
    vehicleKind: ["Car"],
    linkId: ["curve"],
    startTick: [0],
    endTick: [100],
    startFrac: [0],
    endFrac: [1],
    lon0: [2],
    lat0: [48],
    lon1: [2.001],
    lat1: [48.001],
    speedKmh: [30],
    co2Grams: [0],
    noxGrams: [0],
    pm25Grams: [0],
  }
  const roads = new Map([["curve", road]])
  assert.equal(
    computeVehiclePositions(segments, 5, new Map(), roads)[0].angle,
    -90
  )
  assert.ok(
    Math.abs(computeVehiclePositions(segments, 95, new Map(), roads)[0].angle) <
      1e-6
  )
  segments.startFrac = [1]
  segments.endFrac = [0]
  assert.equal(
    computeVehiclePositions(segments, 95, new Map(), roads)[0].angle,
    90
  )
})

test("opposing signal approaches swap color at the phase boundary, including offset and rewind", () => {
  const { nodes, links, signal } = fixture()
  const markers = buildSignalMarkers(nodes, links, [signal])
  const west = markers.find((m) => m.origin === "west"),
    south = markers.find((m) => m.origin === "south")
  assert.equal(markers.length, 3)
  assert.equal(signalAppearance(west, 34.999), "Green")
  assert.equal(signalAppearance(south, 34.999), "Red")
  assert.equal(signalAppearance(west, 35), "Red")
  assert.equal(signalAppearance(south, 35), "Green")
  assert.equal(signalAppearance(west, 70), "Green")
  assert.equal(signalAppearance(west, 10), "Green")
  assert.equal(signalAppearance(west, 9), "Unknown")
  assert.equal(signalAppearance(markers[2], 35), "Unknown")
  assert.ok(west.position[0] < 2 && west.position[1] < 48)
  assert.ok(south.position[0] > 2 && south.position[1] < 48)
  const before = createSignalSpriteLayer(markers, 34),
    after = createSignalSpriteLayer(markers, 35)
  assert.notEqual(before.props.getIcon(west).url, after.props.getIcon(west).url)
  assert.equal(after.props.updateTriggers.getIcon, 35)
  assert.equal(after.props.sizeUnits, "meters")
  assert.equal(after.props.pickable, true)
})

test("MICRO live observations preserve lane 0, interpolate a lane change and retain it after leaving", () => {
  const { links, nodes } = fixture()
  const store = new LiveSegmentStore(links, nodes, 1)
  const ingest = (tick, event_type, data) =>
    store.ingest({
      simulationId: "run",
      entityId: "car",
      tick,
      lamportTick: tick,
      label: event_type,
      data: { car_id: "car", link_id: "south", event_type, ...data },
    })
  ingest(0, "enter_micro_link", {
    lane: 0,
    initial_position: 5,
    initial_velocity: 5,
  })
  ingest(10, "micro_update", { lane: 1, position: 55, velocity: 5 })
  const snapshot = store.snapshot()
  assert.equal(snapshot.startLane[0], 0)
  assert.equal(snapshot.endLane[0], 1)
  assert.ok(snapshot.startFrac[0] > 0)
  const speeds = new Map([["south", 30]])
  const counts = new Map([["south", 2]])
  const before = computeVehiclePositions(
    snapshot,
    0,
    speeds,
    undefined,
    counts
  )[0]
  const middle = computeVehiclePositions(
    snapshot,
    5,
    speeds,
    undefined,
    counts
  )[0]
  const after = computeVehiclePositions(snapshot, 10, speeds, undefined, counts)
  assert.equal(before.lane, 0)
  assert.equal(middle.lane, 0.5)
  assert.equal(after.length, 1, "one sprite at a shared sample boundary")
  assert.equal(after[0].lane, 1)
  assert.ok(
    before.position[0] > 2,
    "lane 0 sits to the right of northbound travel"
  )
  assert.ok(Math.abs(middle.position[0] - 2) < 1e-6)
  assert.ok(after[0].position[0] < 2)
  ingest(12, "leave_micro_link", { final_position: 70 })
  assert.equal(store.snapshot().endLane.at(-1), 1)
})

test("live subway events resolve rail-only links and draw Subway sprites for string or numeric train IDs", () => {
  const { links, nodes } = fixture()
  const rails = {
    length: 1,
    linkId: ["900"],
    lat0: new Float32Array([48]), lon0: new Float32Array([2]),
    lat1: new Float32Array([48.01]), lon1: new Float32Array([2.01]),
    lengthM: new Float32Array([1000]), lanes: new Int32Array([1]),
    freeSpeedKmh: new Float32Array([60]), railType: ["subway"], subwayLine: ["L1"],
  }
  for (const subwayId of ["train", 42]) {
    const store = new LiveSegmentStore(links, nodes, 1, undefined, "run", rails)
    const event = (tick, event_type) => ({
      simulationId: "run", entityId: "fallback", tick, lamportTick: tick,
      label: event_type,
      data: { event_type, subway_id: subwayId, link_id: 900, travel_time: 20 },
    })
    store.ingest(event(10, "enter_link"))
    const open = store.snapshot()
    assert.equal(open.length, 1)
    assert.equal(open.vehicleKind[0], "Subway")
    assert.equal(open.vehicleId[0], String(subwayId))
    const position = computeVehiclePositions(open, 20, new Map([["900", 60]]))[0]
    assert.equal(position.vehicleKind, "Subway")
    assert.ok(Math.abs(position.position[0] - 2.005) < 0.00001)
    assert.ok(Math.abs(position.position[1] - 48.005) < 0.00001)
    const sprite = createVehicleSpriteLayer([position])
    assert.equal(sprite.props.getIcon(position), vehicleSprite("Subway", "flowing"))
    store.ingest(event(30, "leave_link"))
    const closed = store.snapshot()
    assert.equal(closed.length, 1)
    assert.equal(closed.endTick[0], 30)
  }
  const withoutRails = new LiveSegmentStore(links, nodes, 1)
  withoutRails.ingest({ simulationId: "run", entityId: "train", tick: 10,
    lamportTick: 10, label: "enter_link", data: { event_type: "enter_link",
      subway_id: "train", link_id: "missing", travel_time: 20 } })
  assert.equal(withoutRails.snapshot().length, 0)
})

test("numeric actor IDs retain each transport's sprite kind in live events", () => {
  const { links, nodes } = fixture()
  for (const [key, kind] of [["car_id", "Car"], ["bus_id", "Bus"],
    ["motorcycle_id", "Motorcycle"], ["bicycle_id", "Bicycle"], ["person_id", "Person"]]) {
    const store = new LiveSegmentStore(links, nodes, 1)
    store.ingest({ simulationId: "run", entityId: "fallback", tick: 10, lamportTick: 10,
      label: "enter_link", data: { event_type: "enter_link", [key]: 42,
        link_id: "south", travel_time: 20 } })
    const snapshot = store.snapshot()
    assert.equal(snapshot.vehicleId[0], "42")
    assert.equal(snapshot.vehicleKind[0], kind)
  }
})

test("lane markings respect lane counts; missing lane observations stay unknown", () => {
  const coordinates = [
    [2, 48],
    [2.001, 48],
  ]
  assert.equal(
    microLaneMarkings(coordinates, 1).filter((m) => m.kind === "divider")
      .length,
    0
  )
  assert.ok(
    microLaneMarkings(coordinates, 3).filter((m) => m.kind === "divider")
      .length > 0
  )
  const { links, nodes } = fixture()
  const store = new LiveSegmentStore(links, nodes, 1)
  store.ingest({
    simulationId: "run",
    entityId: "car",
    tick: 0,
    lamportTick: 0,
    label: "enter_micro_link",
    data: { car_id: "car", link_id: "south" },
  })
  assert.ok(Number.isNaN(store.snapshot().startLane[0]))
})

test("the binary worker and SVG renderer agree on MICRO lane positions", async () => {
  const { buildSegmentBuffers, segmentBufferTransferList } =
    await import("../components/live/workers/segmentBuffers.ts")
  const { links, nodes } = fixture()
  const store = new LiveSegmentStore(links, nodes, 1)
  const ingest = (tick, label, data) =>
    store.ingest({
      simulationId: "run",
      entityId: "car",
      tick,
      lamportTick: tick,
      label,
      data: { car_id: "car", link_id: "south", ...data },
    })
  ingest(0, "enter_micro_link", { lane: 0 })
  ingest(10, "micro_update", { lane: 1, position: 50, velocity: 5 })
  const segments = store.snapshot(),
    counts = new Map([["south", 2]]),
    speeds = new Map([["south", 30]])
  const buffers = buildSegmentBuffers(segments, speeds, undefined, counts)
  assert.notEqual(buffers.startLane.buffer, segments.startLane.buffer)
  assert.ok(
    segmentBufferTransferList(buffers).includes(buffers.startLane.buffer)
  )
  const messages = []
  const scope = { postMessage: (message) => messages.push(message) }
  const previousSelf = globalThis.self
  globalThis.self = scope
  try {
    await import("../components/live/workers/vehicleWorker.ts")
  } finally {
    if (previousSelf === undefined) delete globalThis.self
    else globalThis.self = previousSelf
  }
  scope.onmessage({ data: { type: "init", buffers } })
  scope.onmessage({
    data: {
      type: "frame",
      requestId: 1,
      currentTick: 5,
      bounds: { west: 1.9, south: 47.9, east: 2.1, north: 48.1 },
    },
  })
  const frame = messages.at(-1),
    expected = computeVehiclePositions(
      segments,
      5,
      speeds,
      undefined,
      counts
    )[0]
  assert.equal(frame.count, 1)
  assert.ok(Math.abs(frame.positions[0] - expected.position[0]) < 1e-6)
  assert.ok(Math.abs(frame.positions[1] - expected.position[1]) < 1e-5)
})

const { offsetPolyline, dashPolyline, sleeperSegments, laneMarkings } =
  await import("../components/live/map/laneGeometry.ts")
const { buildLaneMarks, snapWindow } =
  await import("../components/live/map/layers/laneLayer.ts")
const { buildRailStrokes, createRailLinkLayers } =
  await import("../components/live/map/layers/railLinkLayer.ts")
const { createStopSpriteLayer } =
  await import("../components/live/map/layers/stopSpriteLayer.ts")

const metres = (a, b) =>
  Math.hypot(
    (b[0] - a[0]) * 111195 * Math.cos((a[1] * Math.PI) / 180),
    (b[1] - a[1]) * 111195
  )

test("lane geometry offsets, dashes and sleepers are metric", () => {
  const line = [
    [2, 48],
    [2.001, 48],
  ]
  const left = offsetPolyline(line, 3)
  assert.ok(Math.abs(metres(line[0], left[0]) - 3) < 0.01 && left[0][1] > 48)
  const dashes = dashPolyline(line, 3, 5)
  assert.ok(Math.abs(metres(dashes[0][0], dashes[0][1]) - 3) < 0.01)
  assert.ok(Math.abs(metres(dashes[0][0], dashes[1][0]) - 8) < 0.01)
  const ties = sleeperSegments(line, 0.7, 1.2)
  assert.ok(Math.abs(metres(ties[0][0], ties[0][1]) - 2.4) < 0.01)
  assert.ok(Math.abs(metres(ties[0][0], ties[1][0])) > 0.6)
  const marks = laneMarkings(line, 3)
  assert.ok(
    marks.some((m) => m.kind === "divider") &&
      marks.filter((m) => m.kind === "edge").length === 2
  )
  assert.equal(
    laneMarkings(line, 1).filter((m) => m.kind === "divider").length,
    0
  )
})

test("lane markings are built only inside the camera window", () => {
  const { links } = fixture()
  const { key, window } = snapWindow(2, 48, 17.3)
  assert.ok(
    window.west < 2 && window.east > 2 && window.south < 48 && window.north > 48
  )
  assert.equal(snapWindow(2.00001, 48.00001, 17.9).key, key)
  assert.ok(buildLaneMarks(links, window).length > 0)
  const long = {
    ...links,
    lon0: new Float32Array([1.9, 2]),
    lon1: new Float32Array([2.1, 2]),
    lat0: new Float32Array([48, 47.999]),
    lat1: new Float32Array([48, 48]),
  }
  assert.ok(
    buildLaneMarks(long, { west: 1.99, east: 2.01, south: 47.9, north: 48.1 })
      .length > 0
  )
  assert.equal(
    buildLaneMarks(links, { west: 10, east: 11, south: 10, north: 11 }).length,
    0
  )
})

test("rail links render as bed + two rails per track, with sleepers only in the detail window", () => {
  const rail = {
    length: 1,
    linkId: ["r"],
    lon0: new Float32Array([2]),
    lat0: new Float32Array([48]),
    lon1: new Float32Array([2.001]),
    lat1: new Float32Array([48]),
    lengthM: new Float32Array([74]),
    lanes: new Int32Array([2]),
    freeSpeedKmh: new Float32Array([60]),
    railType: ["subway"],
    subwayLine: ["L1"],
  }
  const far = buildRailStrokes(rail, null)
  assert.equal(far.bed.length, 2)
  assert.equal(far.fine.length, 4)
  const near = buildRailStrokes(rail, {
    west: 1,
    east: 3,
    south: 47,
    north: 49,
  })
  assert.ok(near.fine.length > 100)
  assert.notDeepEqual(
    far.bed[0].color,
    buildRailStrokes({ ...rail, subwayLine: [""] }, null).bed[0].color
  )
  assert.deepEqual(
    createRailLinkLayers(rail, null).map((l) => l.props.id),
    ["rail-bed", "rail-detail"]
  )
})

test("stops are metric sprites that scale with zoom", () => {
  const layer = createStopSpriteLayer([])
  assert.equal(layer.props.sizeUnits, "meters")
  assert.ok(
    layer.props.getSize({ kind: "SubwayStation" }) >
      layer.props.getSize({ kind: "BusStop" })
  )
})
