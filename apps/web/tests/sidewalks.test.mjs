import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"

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

const {
  SidewalkNetwork,
  prepareWalkingScene,
  sidewalkOffset,
  SIDEWALK_WIDTH_M,
} = await import("../components/live/map/sidewalks.ts")
const { buildSidewalks, createSidewalkLayer } =
  await import("../components/live/map/layers/sidewalkLayer.ts")
const { computeVehiclePositions } =
  await import("../components/live/map/layers/vehicleScatterLayer.ts")
const { buildSegmentBuffers, segmentBufferTransferList } =
  await import("../components/live/workers/segmentBuffers.ts")
const { distanceMetres } =
  await import("../components/live/map/roadGeometry.ts")

test("sidewalk rendering and walking access honor the Link model configuration", () => {
  const { links } = fixture()
  links.sidewalkEnabled = new Int32Array([0, 1])
  links.sidewalkWidthM = new Float32Array([1.8, 2.5])
  links.sidewalkGapM = new Float32Array([0.3, 0.6])
  const bands = buildSidewalks(links, {
    west: 1.9,
    east: 2.1,
    south: 47.9,
    north: 48.1,
  })
  assert.equal(bands.length, 2, "the disabled road has no sidewalk bands")
  assert.equal(createSidewalkLayer(bands).props.getWidth(bands[0]), 2.5)
  assert.ok(
    Math.abs(
      distanceMetres([links.lon0[1], links.lat0[1]], bands[0].path[0]) -
        (1.6 + 0.6 + 1.25)
    ) < 0.02
  )
  const network = new SidewalkNetwork(links)
  assert.equal(
    network.route(
      "east",
      [links.lon0[0], links.lat0[0]],
      [links.lon1[0], links.lat1[0]],
      false
    ).blocked,
    true
  )
})

function fixture() {
  const links = {
    length: 2,
    linkId: ["east", "north"],
    lon0: new Float32Array([2, 2.001]),
    lat0: new Float32Array([48, 48]),
    lon1: new Float32Array([2.001, 2.001]),
    lat1: new Float32Array([48, 48.001]),
    lengthM: new Float32Array([75, 111]),
    lanes: new Int32Array([2, 1]),
    simulationMode: ["MICRO", "MICRO"],
    freeSpeedKmh: new Float32Array([30, 30]),
  }
  const segments = {
    length: 2,
    vehicleId: ["walker", "car"],
    vehicleKind: ["Person", "Car"],
    linkId: ["walk:origin:destination", "east"],
    startTick: new Float64Array([10, 10]),
    endTick: new Float64Array([110, 110]),
    lon0: new Float32Array([2, 2]),
    lat0: new Float32Array([48, 48]),
    lon1: new Float32Array([2.001, 2.001]),
    lat1: new Float32Array([48.001, 48]),
    startFrac: new Float32Array([0, 0]),
    endFrac: new Float32Array([1, 1]),
    speedKmh: new Float32Array([5, 30]),
    co2Grams: new Float32Array(2),
    noxGrams: new Float32Array(2),
    pm25Grams: new Float32Array(2),
  }
  return { links, segments }
}

test("sidewalk bands sit outside the road at metre scale and are culled with the viewport", () => {
  const { links } = fixture()
  const bands = buildSidewalks(links, {
    west: 1.9,
    east: 2.1,
    south: 47.9,
    north: 48.1,
  })
  assert.equal(bands.length, 4)
  const centre = [links.lon0[0], links.lat0[0]]
  assert.ok(
    Math.abs(distanceMetres(centre, bands[0].path[0]) - sidewalkOffset(2)) <
      0.02
  )
  assert.ok(sidewalkOffset(2) - SIDEWALK_WIDTH_M / 2 > (2 * 3.2) / 2)
  assert.ok(bands[0].path[0][1] < 48 && bands[1].path[0][1] > 48)
  assert.equal(
    buildSidewalks(links, { west: 10, east: 11, south: 10, north: 11 }).length,
    0
  )
  const layer = createSidewalkLayer(bands)
  assert.equal(layer.props.widthUnits, "meters")
  assert.equal(layer.props.getWidth(bands[0]), 1.8)
  assert.equal(layer.props.pickable, false)
})

test("walking endpoints follow virtual road-side paths around bends without changing the simulation clock or cars", () => {
  const { links, segments } = fixture()
  const network = new SidewalkNetwork(links)
  const scene = prepareWalkingScene(segments, network)
  assert.equal(scene.paths.size, 1)
  assert.equal(scene.fallbackPaths.length, 0)
  assert.equal(
    scene.connectors.length,
    1,
    "a virtual sidewalk connects the two street edges at the corner"
  )
  assert.ok(scene.segments.linkId[0].startsWith("sidewalk:"))
  assert.equal(scene.segments.linkId[1], "east")
  assert.equal(segments.linkId[0], "walk:origin:destination")
  assert.equal(scene.segments.startTick, segments.startTick)
  assert.equal(scene.segments.endTick, segments.endTick)
  const nextSnapshot = prepareWalkingScene({ ...segments }, network)
  assert.equal(
    nextSnapshot.paths.get(scene.segments.linkId[0]),
    scene.paths.get(scene.segments.linkId[0]),
    "live snapshots reuse indexed walking routes"
  )
  const path = [...scene.paths.values()][0].road.coordinates
  assert.ok(path[0][1] < 48, "eastbound walking uses the southern sidewalk")
  assert.ok(
    path.at(-1)[0] > links.lon1[1],
    "northbound walking uses the eastern sidewalk"
  )
  const positions = computeVehiclePositions(
    scene.segments,
    35,
    new Map(),
    scene.paths
  )
  const pedestrian = positions.find((p) => p.vehicleKind === "Person")
  assert.ok(
    pedestrian.position[1] < 48,
    "the pedestrian follows the street, not a diagonal across the block"
  )
  const originalCar = computeVehiclePositions(segments, 35, new Map()).find(
    (p) => p.vehicleKind === "Car"
  )
  assert.deepEqual(
    positions.find((p) => p.vehicleKind === "Car"),
    originalCar
  )
})

test("walking on a known curved street follows its offset polyline", () => {
  const { links, segments } = fixture()
  const coordinates = [
    [2, 48],
    [2.0005, 47.9998],
    [2.001, 48],
  ]
  links.roadNetwork = { links: { east: { coordinates } } }
  segments.linkId[0] = "east"
  segments.lat1[0] = 48
  const scene = prepareWalkingScene(segments, new SidewalkNetwork(links))
  const path = scene.paths.get(scene.segments.linkId[0]).road.coordinates
  assert.equal(path.length, 3)
  assert.ok(path[1][1] < coordinates[1][1])
  const pedestrian = computeVehiclePositions(
    scene.segments,
    60,
    new Map(),
    scene.paths
  )[0]
  assert.ok(pedestrian.position[1] < 47.9998)
})

test("pedestrians can walk against vehicle traffic and reversed fractions keep their direction", () => {
  const { links } = fixture()
  const network = new SidewalkNetwork(links)
  const from = [links.lon0[0], links.lat0[0]],
    to = [links.lon1[0], links.lat1[0]]
  const reverse = network.route("walk:return", to, from, false)
  assert.equal(reverse.fallback, false)
  assert.ok(reverse.coordinates[0][1] > 48)
  assert.ok(reverse.coordinates[0][0] > reverse.coordinates.at(-1)[0])
  const reversedFractions = network.route("walk:reverse", from, to, true)
  assert.ok(
    reversedFractions.coordinates[0][0] <
      reversedFractions.coordinates.at(-1)[0]
  )
  assert.ok(reversedFractions.coordinates[0][1] > 48)
})

test("unmapped walking geometry remains a visible virtual corridor, and non-walking tables are reused", () => {
  const { segments } = fixture()
  const empty = { length: 0, linkId: [] }
  const scene = prepareWalkingScene(segments, new SidewalkNetwork(empty))
  assert.equal(scene.fallbackPaths.length, 1)
  assert.ok(scene.paths.size > 0)
  const cars = { ...segments, vehicleKind: ["Car", "Car"] }
  assert.equal(
    prepareWalkingScene(cars, new SidewalkNetwork(empty)).segments,
    cars
  )
})

test("binary circles and SVG pedestrians share the same sidewalk geometry", async () => {
  const { links, segments } = fixture()
  const scene = prepareWalkingScene(segments, new SidewalkNetwork(links))
  const buffers = buildSegmentBuffers(scene.segments, new Map(), scene.paths)
  assert.ok(
    segmentBufferTransferList(buffers).includes(
      buffers.roads.coordinates.buffer
    )
  )
  const messages = [],
    scope = { postMessage: (message) => messages.push(message) }
  const previous = globalThis.self
  globalThis.self = scope
  try {
    await import("../components/live/workers/vehicleWorker.ts")
  } finally {
    if (previous === undefined) delete globalThis.self
    else globalThis.self = previous
  }
  scope.onmessage({ data: { type: "init", buffers } })
  scope.onmessage({
    data: {
      type: "frame",
      requestId: 1,
      currentTick: 35,
      bounds: { west: 1.9, east: 2.1, south: 47.9, north: 48.1 },
    },
  })
  const frame = messages.at(-1),
    positions = computeVehiclePositions(
      scene.segments,
      35,
      new Map(),
      scene.paths
    )
  assert.equal(frame.count, 2)
  positions.forEach((position, i) => {
    assert.ok(Math.abs(frame.positions[i * 2] - position.position[0]) < 1e-6)
    assert.ok(
      Math.abs(frame.positions[i * 2 + 1] - position.position[1]) < 1e-5
    )
  })
})
