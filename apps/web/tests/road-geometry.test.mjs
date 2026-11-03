import assert from "node:assert/strict"
import test from "node:test"
import {
  indexRoad,
  positionOnRoad,
  packRoads,
  positionOnPackedRoad,
  validateRoadNetwork,
} from "../components/live/map/roadGeometry.ts"
import {
  createLinkLayerBinary,
  buildPositionBuffers,
  linkSegmentAt,
} from "../components/live/map/layers/linkLayer.ts"

function road() {
  return {
    osmWayId: "9007199254740993",
    osmNodeIds: ["101", "102", "103"],
    name: "Curved street",
    direction: "forward",
    tags: { highway: "residential" },
    coordinates: [
      [2, 48],
      [2.001, 48.001],
      [2.002, 48],
    ],
  }
}

test("vehicles follow the road bend instead of the endpoint chord", () => {
  const indexed = indexRoad(road())
  const bend = positionOnRoad(indexed, indexed.cumulative[1])
  assert.deepEqual(bend, [2.001, 48.001])
  assert.ok(Math.abs(bend[1] - 48) > 0.0009)
  assert.deepEqual(positionOnRoad(indexed, -1), [2, 48])
  assert.deepEqual(positionOnRoad(indexed, 2), [2.002, 48])
})

test("packed worker and detail renderer agree at every sampled fraction and both directions", () => {
  const forward = indexRoad(road())
  const reverseRoad = road()
  reverseRoad.coordinates.reverse()
  reverseRoad.osmNodeIds.reverse()
  reverseRoad.direction = "backward"
  const backward = indexRoad(reverseRoad)
  const paths = new Map([
    ["1", forward],
    ["2", backward],
  ])
  const packed = packRoads(paths, ["1", "2", "walking"])
  for (let step = 0; step <= 100; step++) {
    const fraction = step / 100
    assert.deepEqual(
      positionOnPackedRoad(packed, 0, fraction),
      positionOnRoad(forward, fraction)
    )
    assert.deepEqual(
      positionOnPackedRoad(packed, 1, fraction),
      positionOnRoad(backward, fraction)
    )
    const a = positionOnRoad(forward, fraction),
      b = positionOnRoad(backward, 1 - fraction)
    assert.ok(Math.abs(a[0] - b[0]) < 1e-10 && Math.abs(a[1] - b[1]) < 1e-10)
  }
  assert.equal(positionOnPackedRoad(packed, 2, 0.5), null)
  assert.equal(packRoads(new Map(), []).coordinates.length, 0)
})

test("OSM source ids retain 64-bit precision and geometry must cover the HTC graph", () => {
  const links = {
    length: 1,
    linkId: ["7"],
    lon0: [2],
    lat0: [48],
    lon1: [2.002],
    lat1: [48],
  }
  const network = {
    schema: "htc.road-network.v1",
    mode: "osm",
    source: { kind: "openstreetmap" },
    links: { 7: road() },
  }
  assert.equal(
    validateRoadNetwork(network, links).links["7"].osmWayId,
    "9007199254740993"
  )
  network.links["7"].coordinates.reverse()
  assert.throws(() => validateRoadNetwork(network, links), /endpoints/)
  network.links = {}
  assert.throws(() => validateRoadNetwork(network, links), /cover/)
})

test("road drawing and click metadata share the curved path; standalone keeps its original LineLayer", () => {
  const links = {
    length: 1,
    linkId: ["7"],
    lon0: new Float32Array([2]),
    lat0: new Float32Array([48]),
    lon1: new Float32Array([2.002]),
    lat1: new Float32Array([48]),
    lengthM: new Float32Array([250]),
    lanes: new Int32Array([1]),
    simulationMode: ["MICRO"],
    freeSpeedKmh: new Float32Array([30]),
  }
  const original = createLinkLayerBinary(
    links,
    buildPositionBuffers(links),
    null
  )
  assert.equal(original.constructor.layerName, "LineLayer")
  assert.equal(linkSegmentAt(links, 0).osm, undefined)
  links.roadNetwork = { links: { 7: road() } }
  const curved = createLinkLayerBinary(links, buildPositionBuffers(links), "7")
  assert.equal(curved.constructor.layerName, "PathLayer")
  assert.deepEqual(
    curved.props.getPath(curved.props.data[0]),
    road().coordinates
  )
  assert.equal(curved.props.pickable, true)
  assert.equal(linkSegmentAt(links, 0).osm.osmWayId, "9007199254740993")
})
