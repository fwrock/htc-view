/** Audit downloaded real-run artifacts through the same geometry and picking kernels as HTC View. */
import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import path from "node:path"
import process from "node:process"
import { tableFromIPC } from "apache-arrow"
import {
  validateRoadNetwork,
  roadLookup,
  packRoads,
  positionOnRoad,
  positionOnPackedRoad,
  distanceMetres,
} from "../components/live/map/roadGeometry.ts"
import {
  buildPositionBuffers,
  createLinkLayerBinary,
  linkSegmentAt,
} from "../components/live/map/layers/linkLayer.ts"

const directory = process.argv[2]
if (!directory)
  throw new Error(
    "Usage: node --experimental-strip-types scripts/check-map-geometry.mjs <downloaded-replay-dir> [evidence.json]"
  )
const manifest = JSON.parse(
  await readFile(path.join(directory, "manifest.json"), "utf8")
)
const arrow = async (name) =>
  tableFromIPC(new Uint8Array(await readFile(path.join(directory, name))))
const table = await arrow("links.arrow")
const column = (name) => table.getChild(name).toArray()
const links = {
  length: table.numRows,
  linkId: [...column("link_id")],
  lat0: Float32Array.from(column("lat0")),
  lon0: Float32Array.from(column("lon0")),
  lat1: Float32Array.from(column("lat1")),
  lon1: Float32Array.from(column("lon1")),
  lengthM: Float32Array.from(column("length_m")),
  lanes: Int32Array.from(column("lanes")),
  simulationMode: [...column("simulation_mode")],
  freeSpeedKmh: Float32Array.from(column("free_speed_kmh")),
}
const segments = await arrow("segments.arrow")
const osm = manifest.mapMode === "osm"
let samples = 0,
  maximumCurveDeviationM = 0
let wayIds = []
if (osm) {
  assert.equal(manifest.files.roadNetwork, "road_network.json")
  const bytes = await readFile(path.join(directory, "road_network.json"))
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    manifest.source.roadNetworkSha256
  )
  links.roadNetwork = validateRoadNetwork(JSON.parse(bytes), links)
  for (const road of Object.values(links.roadNetwork.links)) {
    for (const [lon, lat] of road.coordinates) {
      assert.ok(
        lon >= manifest.boundingBox.minLon &&
          lon <= manifest.boundingBox.maxLon &&
          lat >= manifest.boundingBox.minLat &&
          lat <= manifest.boundingBox.maxLat,
        "Replay bounds must include the entire OSM road shape"
      )
    }
  }
  const roads = roadLookup(links)
  const linkIds = [...segments.getChild("link_id").toArray()]
  const packed = packRoads(roads, linkIds)
  const start = segments.getChild("start_frac").toArray(),
    end = segments.getChild("end_frac").toArray()
  linkIds.forEach((id, segmentIndex) => {
    const road = roads.get(id)
    assert.ok(road, id)
    for (let step = 0; step <= 20; step++) {
      const fraction =
        start[segmentIndex] +
        ((end[segmentIndex] - start[segmentIndex]) * step) / 20
      assert.deepEqual(
        positionOnPackedRoad(packed, segmentIndex, fraction),
        positionOnRoad(road, fraction)
      )
      samples++
    }
  })
  for (const road of roads.values()) {
    const first = road.road.coordinates[0],
      last = road.road.coordinates.at(-1)
    road.road.coordinates.forEach((point, index) => {
      const fraction = road.cumulative[index]
      const actual = positionOnRoad(road, fraction)
      assert.ok(distanceMetres(actual, point) < 1e-6)
      const chord = [
        first[0] + (last[0] - first[0]) * fraction,
        first[1] + (last[1] - first[1]) * fraction,
      ]
      maximumCurveDeviationM = Math.max(
        maximumCurveDeviationM,
        distanceMetres(actual, chord)
      )
    })
  }
  assert.ok(
    maximumCurveDeviationM > 10,
    "The OSM acceptance fixture must expose a meaningful curve/chord difference"
  )
  wayIds = [
    ...new Set(
      Object.values(links.roadNetwork.links).map((road) => road.osmWayId)
    ),
  ]
}
const layer = createLinkLayerBinary(links, buildPositionBuffers(links), null)
assert.equal(layer.constructor.layerName, osm ? "PathLayer" : "LineLayer")
assert.equal(layer.props.pickable, true)
links.linkId.forEach((id, index) => {
  const picked = linkSegmentAt(links, index)
  assert.equal(picked.linkId, id)
  if (osm) {
    assert.equal(picked.osm.osmWayId, links.roadNetwork.links[id].osmWayId)
    assert.deepEqual(
      layer.props.getPath(layer.props.data[index]),
      picked.osm.coordinates
    )
  } else assert.equal(picked.osm, undefined)
})
const evidence = {
  status: "passed",
  scenario_id: manifest.scenarioId,
  mode: osm ? "osm" : "standalone",
  links: links.length,
  segments: segments.numRows,
  normal_worker_position_comparisons: samples,
  maximum_curve_chord_deviation_metres: maximumCurveDeviationM,
  osm_way_ids: wayIds,
  layer: layer.constructor.layerName,
  link_picking_metadata: "passed",
  browser_webgl: "not tested by this script",
}
if (process.argv[3])
  await writeFile(process.argv[3], JSON.stringify(evidence, null, 2) + "\n")
console.log(JSON.stringify(evidence, null, 2))
