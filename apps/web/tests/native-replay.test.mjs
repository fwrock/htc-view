import assert from "node:assert/strict"
import { Buffer } from "node:buffer"
import { createHash } from "node:crypto"
import { createServer } from "node:http"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  bindNativeReplayManifest,
  nativeReplayManifestMatches,
  nativeReplayDescriptor,
  nativeReplayRunId,
  prepareNativeReplay,
  replayRunCommand,
  validReplayName,
} from "../lib/native-replay.ts"

const runId = "a".repeat(32)
const scenario = `simedape-${runId}`
const sha = (data) => createHash("sha256").update(data).digest("hex")

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "htc replay test "))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const prefix = `/api/runs/${runId}/native`
  const data = new Map([
    [
      `${prefix}/replay/files/simulation.json`,
      Buffer.from('{"startTick":0,"endTick":180}'),
    ],
    [`${prefix}/replay/files/nodes_0.json`, Buffer.from('[{"id":1}]')],
    [`${prefix}/replay/files/links_1.json`, Buffer.from('[{"id":2}]')],
    [
      `${prefix}/artifacts/committed.parquet`,
      Buffer.from("committed output of this run"),
    ],
  ])
  const file = (name, url) => ({ name, url, sha256: sha(data.get(url)) })
  const descriptor = {
    schema: "simedape.native_replay.v1",
    run_id: runId,
    scenario_id: scenario,
    receipt_sha256: "b".repeat(64),
    files: ["simulation.json", "nodes_0.json", "links_1.json"].map((name) =>
      file(name, `${prefix}/replay/files/${name}`)
    ),
    report: file("committed.parquet", `${prefix}/artifacts/committed.parquet`),
  }
  const server = createServer((req, res) => {
    if (req.url === `${prefix}/replay`) {
      res.setHeader("Content-Type", "application/json")
      res.end(JSON.stringify(descriptor))
    } else if (data.has(req.url)) res.end(data.get(req.url))
    else {
      res.writeHead(404)
      res.end('{"error":"not found"}')
    }
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  return {
    dir,
    descriptor,
    data,
    base: `http://127.0.0.1:${server.address().port}`,
  }
}

test("native identities are strict and file routes reject path traversal", () => {
  assert.equal(nativeReplayRunId(scenario), runId)
  assert.equal(nativeReplayRunId("ordinary-scenario"), null)
  assert.equal(nativeReplayRunId("simedape-ordinary-11"), null)
  assert.throws(() => nativeReplayRunId("simedape-../x"))
  assert.equal(validReplayName("../source"), false)
  assert.equal(validReplayName("a/b"), false)
  assert.equal(validReplayName("a\\b"), false)
  assert.equal(validReplayName("."), false)
  assert.equal(validReplayName(scenario), true)
})

test("clock, geometry and committed report are downloaded into one run's private input directory", async (t) => {
  const f = await fixture(t)
  const prepared = await prepareNativeReplay(scenario, f.dir, f.base)
  assert.equal(
    await readFile(path.join(prepared.dataDir, "nodes_0.json"), "utf8"),
    '[{"id":1}]'
  )
  assert.equal(
    await readFile(path.join(prepared.parquetDir, "committed.parquet"), "utf8"),
    "committed output of this run"
  )
  assert.equal(
    JSON.parse(
      await readFile(path.join(prepared.dataDir, "../simulation.json"), "utf8")
    ).endTick,
    180
  )
  assert.ok(prepared.dataDir.includes(runId))
  assert.ok(
    replayRunCommand(
      scenario,
      prepared.parquetDir,
      prepared.dataDir,
      f.dir
    ).includes(JSON.stringify(f.dir))
  )
})

test("changed report bytes are refused before ETL can consume them", async (t) => {
  const f = await fixture(t)
  f.data.set(f.descriptor.report.url, Buffer.from("another run's output"))
  await assert.rejects(
    prepareNativeReplay(scenario, f.dir, f.base),
    /hash mismatch: committed.parquet/
  )
})

test("foreign identity, traversal names, duplicate files and foreign URLs are rejected", async (t) => {
  const f = await fixture(t)
  const original = structuredClone(f.descriptor)
  for (const mutate of [
    (d) => {
      d.run_id = "c".repeat(32)
    },
    (d) => {
      d.files[0].name = "../simulation.json"
    },
    (d) => {
      d.files.push(d.files[0])
    },
    (d) => {
      d.report.url = "https://unrelated.invalid/report.parquet"
    },
  ]) {
    Object.assign(f.descriptor, structuredClone(original))
    mutate(f.descriptor)
    await assert.rejects(nativeReplayDescriptor(scenario, f.base))
  }
})

test("ETL manifest is published with source identity only when it contains vehicles", async (t) => {
  const f = await fixture(t)
  const filename = path.join(f.dir, "manifest.json")
  await writeFile(
    filename,
    JSON.stringify({ scenarioId: scenario, vehicleCount: 0 })
  )
  await assert.rejects(
    bindNativeReplayManifest(f.dir, f.descriptor),
    /no vehicles/
  )
  await writeFile(
    filename,
    JSON.stringify({ scenarioId: "different-run", vehicleCount: 16 })
  )
  await assert.rejects(
    bindNativeReplayManifest(f.dir, f.descriptor),
    /different run identity/
  )
  await writeFile(
    filename,
    JSON.stringify({
      scenarioId: scenario,
      vehicleCount: 16,
      boundingBox: { minLat: 0, maxLat: 100, minLon: 0, maxLon: 300 },
    })
  )
  await assert.rejects(
    bindNativeReplayManifest(f.dir, f.descriptor),
    /map coordinates/
  )
  await writeFile(
    filename,
    JSON.stringify({
      scenarioId: scenario,
      vehicleCount: 16,
      boundingBox: { minLat: 48, maxLat: 48.01, minLon: 2, maxLon: 2.01 },
    })
  )
  await bindNativeReplayManifest(f.dir, f.descriptor)
  const manifest = JSON.parse(await readFile(filename, "utf8"))
  assert.equal(manifest.source.runId, runId)
  assert.equal(manifest.source.receiptSha256, f.descriptor.receipt_sha256)
  assert.equal(manifest.source.committedSha256, f.descriptor.report.sha256)
  assert.equal(nativeReplayManifestMatches(manifest, f.descriptor), true)
  manifest.source.runId = "c".repeat(32)
  assert.equal(nativeReplayManifestMatches(manifest, f.descriptor), false)
})

test("OSM replay bounds include interior road vertices and bind the shape fingerprint", async (t) => {
  const f = await fixture(t)
  const url = `/api/runs/${runId}/native/replay/files/road_network.json`
  const bytes = Buffer.from(
    JSON.stringify({
      schema: "htc.road-network.v1",
      links: {
        1: {
          coordinates: [
            [2, 48],
            [3, 49],
            [2.1, 48.1],
          ],
        },
      },
    })
  )
  f.data.set(url, bytes)
  f.descriptor.files.push({
    name: "road_network.json",
    sha256: sha(bytes),
    url,
  })
  const prepared = await prepareNativeReplay(scenario, f.dir, f.base)
  const out = path.join(f.dir, scenario)
  await mkdir(out)
  await writeFile(
    path.join(out, "manifest.json"),
    JSON.stringify({
      scenarioId: scenario,
      vehicleCount: 16,
      boundingBox: { minLat: 48, maxLat: 48.1, minLon: 2, maxLon: 2.1 },
      files: {},
    })
  )
  await bindNativeReplayManifest(out, prepared.descriptor)
  const manifest = JSON.parse(
    await readFile(path.join(out, "manifest.json"), "utf8")
  )
  assert.equal(manifest.mapMode, "osm")
  assert.equal(manifest.boundingBox.maxLat, 49)
  assert.equal(manifest.boundingBox.maxLon, 3)
  assert.equal(manifest.source.roadNetworkSha256, sha(bytes))
  assert.equal(nativeReplayManifestMatches(manifest, f.descriptor), true)
  assert.equal(
    (await readFile(path.join(out, "road_network.json"))).toString(),
    bytes.toString()
  )
})
