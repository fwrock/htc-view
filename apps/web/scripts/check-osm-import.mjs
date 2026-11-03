/** Exercise the import screen's actual API client against a running platform API. */
import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"
import {
  browseOsmSources,
  getOsmJob,
  previewOsm,
  publishOsm,
} from "../lib/osm-import-api.ts"
import { getNativeCatalogue, startNativeRun } from "../lib/simedape-api.ts"

const { values } = parseArgs({
  options: {
    "source-location": { type: "string" },
    source: { type: "string" },
    "target-location": { type: "string" },
    revision: { type: "string" },
    output: { type: "string" },
    bbox: { type: "string" },
    run: { type: "boolean", default: false },
  },
})
for (const key of [
  "source-location",
  "source",
  "target-location",
  "revision",
  "output",
])
  assert.ok(values[key], `--${key} is required`)
await mkdir(values.output, { recursive: false })
const save = (name, value) =>
  writeFile(
    path.join(values.output, name),
    JSON.stringify(value, null, 2) + "\n"
  )
async function wait(id) {
  const deadline = Date.now() + 900_000
  let previous
  while (Date.now() < deadline) {
    const job = await getOsmJob(id)
    if (job.status !== previous) console.log(`${id}: ${job.status}`)
    previous = job.status
    assert.ok(
      !["failed", "cancelled"].includes(job.status),
      job.error ?? job.logs
    )
    if (job.status === "completed") {
      assert.ok(job.result?.osm_import)
      return job.result.osm_import
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Import job ${id} timed out`)
}
const directory = values.source.split("/").slice(0, -1).join("/")
const listing = await browseOsmSources(values["source-location"], directory)
assert.ok(
  listing.entries.some(
    (entry) => entry.path === values.source && !entry.directory
  )
)
const previewJob = await previewOsm(values["source-location"], values.source, {
  bbox: values.bbox ? values.bbox.split(",").map(Number) : null,
  cars: 16,
  duration: 900,
  max_ways: 100,
  allow_disconnected: false,
})
const preview = await wait(previewJob.run_id)
await save("preview.json", preview)
assert.equal(preview.status, "ready", JSON.stringify(preview.diagnostics))
assert.ok(preview.network.directed_links > 0)
assert.equal(
  preview.geometry_preview.features.length,
  preview.network.directed_links
)
const publishJob = await publishOsm(
  previewJob.run_id,
  values["target-location"],
  values.revision
)
const published = await wait(publishJob.run_id)
await save("published.json", published)
assert.equal(
  published.status,
  "published",
  JSON.stringify(published.diagnostics)
)
assert.equal(published.preview_sha256, preview.preview_sha256)
assert.equal(
  published.scenario_ref,
  `${values["target-location"]}:${values.revision}`
)
const catalogue = await getNativeCatalogue()
const scenario = catalogue.scenarios.find(
  (item) => item.name === published.scenario_ref
)
assert.ok(scenario?.supported, JSON.stringify(scenario))
assert.equal(scenario.map_mode, "osm")
const evidence = {
  status: "passed",
  api_client: "HTC View import client",
  scenario: published.scenario_ref,
  preview_job_id: previewJob.run_id,
  publish_job_id: publishJob.run_id,
  preview_sha256: preview.preview_sha256,
  network: preview.network,
  browser_interaction: "not tested",
}
if (values.run) {
  assert.ok(catalogue.engine_ready, "Engine must be ready for --run")
  evidence.native_run_id = (
    await startNativeRun(published.scenario_ref, 5)
  ).run_id
}
await save("import-check.json", evidence)
console.log(JSON.stringify(evidence, null, 2))
