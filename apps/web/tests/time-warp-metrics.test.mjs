import test from "node:test"
import assert from "node:assert/strict"
import { timeWarpSummary } from "../lib/time-warp-metrics.ts"
const metric = (name, value) => ({ name, value })

test("optimistic mode remains visible before the first rollback", () => {
  const summary = timeWarpSummary([
    metric("htc_time_warp_enabled", 1), metric("htc_time_warp_gvt", 125),
    metric("htc_time_warp_workers", 4), metric("htc_time_warp_commits_total", 3),
  ])
  assert.deepEqual(summary, { enabled: true, gvt: 125, workers: 4, commits: 3, rollbacks: 0, antiMessages: 0 })
})
test("conservative and absent metrics are not presented as active optimistic mode", () => {
  assert.equal(timeWarpSummary([]).enabled, false)
  assert.equal(timeWarpSummary([metric("htc_time_warp_enabled", 0)]).enabled, false)
})
test("rollback labels aggregate and legacy metrics stay readable", () => {
  const result = timeWarpSummary([metric("htc_straggler_rollback_triggered_total", 2), metric("htc_straggler_rollback_triggered_total", 3)])
  assert.equal(result.enabled, true)
  assert.equal(result.rollbacks, 5)
  assert.equal(result.gvt, null)
})
