/** Real managed-run → Kafka → scoped WebSocket check using HTC View's geometry/store code. */
import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { registerHooks } from "node:module"
import { parseArgs } from "node:util"
import path from "node:path"
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && !path.extname(specifier))
      return next(specifier + ".ts", context)
    return next(specifier, context)
  },
})
const { liveRequest, loadLiveGeometry, parseStreamFrame } =
  await import("../lib/native-live.ts")
const { startNativeRun } = await import("../lib/simedape-api.ts")
const { LiveSegmentStore } =
  await import("../components/live/live/liveSegmentStore.ts")
const { values } = parseArgs({
  options: {
    output: { type: "string" },
    scenario: { type: "string", multiple: true },
  },
})
assert.ok(values.output && values.scenario?.length)
await mkdir(values.output, { recursive: false })
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const report = []
const jobs = await Promise.all(
  values.scenario.map(async (scenario) => ({
    scenario,
    ...(await startNativeRun(scenario, 5, true)),
  }))
)
async function check(job) {
  let descriptor
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    descriptor = await liveRequest(`/api/runs/${job.run_id}/native/live`)
    assert.notEqual(descriptor.status, "failed", descriptor.error)
    if (descriptor.geometry_sha256) break
    await pause(200)
  }
  assert.equal(descriptor.state, "awaiting_viewer")
  const geometry = await loadLiveGeometry(descriptor)
  const store = new LiveSegmentStore(
    geometry.links,
    geometry.nodes,
    geometry.raw.ticks_per_second,
    Infinity,
    job.run_id
  )
  const frames = []
  const socket = new WebSocket(descriptor.ws_url)
  let ready
  let error
  let maxSegments = 0
  let firstMotionStatus
  const firstMotionCheck = []
  socket.addEventListener("error", () => {
    error = new Error("WebSocket transport failed")
  })
  socket.addEventListener("message", (event) => {
    try {
      const frame = JSON.parse(event.data)
      if (frame.type === "stream_ready") {
        ready = frame
        return
      }
      assert.equal(
        frame.simulationId,
        job.run_id,
        "Bridge leaked another run into this socket"
      )
      const parsed = parseStreamFrame(event.data, job.run_id)
      assert.ok(parsed)
      assert.equal(
        parseStreamFrame(event.data, "another-run"),
        null,
        "Client must reject foreign runs"
      )
      frames.push(parsed)
      store.ingest(parsed)
      const snapshot =
        frames.length < 10 || frames.length % 100 === 0
          ? store.snapshot()
          : null
      if (snapshot) maxSegments = Math.max(maxSegments, snapshot.length)
      if (snapshot?.length && !firstMotionCheck.length) {
        firstMotionCheck.push(
          liveRequest(`/api/runs/${job.run_id}/progress`).then((progress) => {
            firstMotionStatus = progress.status
          })
        )
      }
    } catch (failure) {
      error = failure
    }
  })
  try {
    while (!ready && !error && Date.now() < deadline) await pause(50)
    if (error) throw error
    assert.ok(ready, "No scoped subscription readiness frame")
    const acknowledgement = {
      ...ready,
      readiness_token: descriptor.readiness_token,
      geometry_sha256: descriptor.geometry_sha256,
    }
    await assert.rejects(() =>
      liveRequest(descriptor.ready_url, {
        ...acknowledgement,
        geometry_sha256: "wrong",
      })
    )
    assert.equal(
      (await liveRequest(`/api/runs/${job.run_id}/native/live`)).state,
      "awaiting_viewer",
      "Wrong geometry must not launch HTC"
    )
    await assert.rejects(() =>
      liveRequest(descriptor.ready_url, {
        ...acknowledgement,
        connection_id: "00000000-0000-0000-0000-000000000000",
      })
    )
    await liveRequest(descriptor.ready_url, acknowledgement)
    let progress
    while (Date.now() < deadline) {
      if (error) throw error
      progress = await liveRequest(`/api/runs/${job.run_id}/progress`)
      if (["completed", "failed", "cancelled"].includes(progress.status)) break
      await pause(200)
    }
    assert.equal(progress.status, "completed", JSON.stringify(progress))
    await pause(700)
    await Promise.all(firstMotionCheck)
    if (error) throw error
    assert.ok(frames.length > 0 && maxSegments > 0, "No live vehicle segments")
    assert.equal(
      firstMotionStatus,
      "running",
      "Vehicle streaming must be observed before managed completion"
    )
    const snapshot = store.snapshot()
    const microUpdates = frames.filter(
      (frame) => frame.label === "micro_update"
    ).length
    const modes = [...new Set(geometry.raw.links.map((link) => link.simulation_mode))].sort()
    const mesoEntries = frames.filter((frame) => frame.label === "enter_link").length
    const mesoExits = frames.filter((frame) => frame.label === "leave_link").length
    if (modes.includes("MICRO"))
      assert.ok(microUpdates > 0, "MICRO position updates must be subscribed")
    else assert.equal(microUpdates, 0, "Pure MESO must not fabricate MICRO updates")
    if (modes.includes("MESO"))
      assert.ok(mesoEntries > 0 && mesoExits > 0, "MESO traversals must be streamed")
    const expectedLinks = new Set(geometry.links.linkId)
    assert.ok(
      snapshot.linkId.every((id) => expectedLinks.has(id)),
      "Events reference different geometry"
    )
    await writeFile(
      path.join(values.output, `${job.run_id}-events.jsonl`),
      frames.map((frame) => JSON.stringify(frame)).join("\n") + "\n"
    )
    await writeFile(
      path.join(values.output, `${job.run_id}-geometry.json`),
      JSON.stringify(geometry.raw, null, 2) + "\n"
    )
    report.push({
      status: "passed",
      run_id: job.run_id,
      scenario: job.scenario,
      frames: frames.length,
      micro_updates: microUpdates,
      meso_entries: mesoEntries,
      meso_exits: mesoExits,
      simulation_modes: modes,
      maximum_live_segments: maxSegments,
      first_motion_job_status: firstMotionStatus,
      geometry_sha256: descriptor.geometry_sha256,
      links: geometry.links.length,
      nodes: geometry.nodes.length,
      mode: geometry.links.roadNetwork ? "osm" : "standalone",
      run_isolation: "passed (bridge and client)",
      rejected_wrong_geometry_and_inactive_subscription: true,
      browser_webgl: "not tested; protocol client acknowledges readiness",
    })
  } finally {
    socket.close()
  }
}
await Promise.all(jobs.map(check))
await writeFile(
  path.join(values.output, "managed-live-check.json"),
  JSON.stringify(report, null, 2) + "\n"
)
console.log(JSON.stringify(report, null, 2))
