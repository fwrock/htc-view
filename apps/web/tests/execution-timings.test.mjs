import test from "node:test"
import assert from "node:assert/strict"
import { executionTimings } from "../lib/execution-timings.ts"
const sample = (name, operation, value, node = "node-0") => ({
  name: `htc_execution_${name}`,
  labels: { operation, node },
  value,
})

test("keeps nodes and operations separate and calculates weighted completed averages", () => {
  const rows = executionTimings([
    sample("duration_seconds_count", "route_vehicle", 4),
    sample("duration_seconds_sum", "route_vehicle", 2),
    sample("duration_max_seconds", "route_vehicle", 1.5),
    sample("duration_last_seconds", "route_vehicle", 0.1),
    sample("elapsed_seconds", "route_vehicle", 3),
    sample("active", "route_vehicle", 2),
    sample("failed_total", "route_vehicle", 1),
    sample("duration_seconds_count", "route_vehicle", 1, "node-1"),
    sample("duration_seconds_sum", "route_vehicle", 9, "node-1"),
    sample("duration_seconds_count", "route_walking", 2),
    sample("duration_seconds_sum", "route_walking", 0.5),
  ])
  assert.equal(rows.length, 3)
  const vehicle = rows.find(
    (r) => r.operation === "route_vehicle" && r.node === "node-0"
  )
  assert.equal(vehicle.meanSeconds, 0.5)
  assert.equal(vehicle.elapsedSeconds, 3)
  assert.equal(vehicle.totalSeconds, 2)
  assert.equal(vehicle.active, 2)
  assert.equal(vehicle.failed, 1)
  assert.equal(vehicle.maxSeconds, 1.5)
  assert.equal(vehicle.lastSeconds, 0.1)
  assert.equal(rows.find((r) => r.node === "node-1").meanSeconds, 9)
})

test("an active first loop is visible before the first histogram observation", () => {
  const [row] = executionTimings([
    sample("elapsed_seconds", "simulation_loop", 12),
    sample("active", "simulation_loop", 1),
  ])
  assert.equal(row.count, 0)
  assert.equal(row.elapsedSeconds, 12)
  assert.equal(row.meanSeconds, null)
  assert.equal(row.maxSeconds, null)
  assert.equal(row.lastSeconds, null)
})

test("unpublished, non-finite and unrelated samples do not invent timings", () => {
  assert.deepEqual(executionTimings([]), [])
  assert.deepEqual(
    executionTimings([
      sample("elapsed_seconds", "simulation_loop", Infinity),
      { name: "jvm_memory_bytes_used", labels: {}, value: 1 },
    ]),
    []
  )
})
