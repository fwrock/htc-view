import test from "node:test"
import assert from "node:assert/strict"
import { simulationStartPlan } from "../lib/simulation-start.ts"

test("applied scenario filters and other editor changes survive starting a selected scenario", () => {
  const config = { name: "edited", duration: 600, loadFilter: { excludeClasses: ["Bicycle"] }, partial: { selectionFile: "/selection.json", filterableClasses: ["Car"] } }
  const plan = simulationStartPlan({ configFile: "/scenarios/base/simulation.json", manualPath: false, appliedConfig: config })
  assert.deepEqual(plan.config, config)
  assert.equal(plan.body, undefined)
})

test("derived runs keep editor filters while adding validated modification and selection paths", () => {
  const original = { loadFilter: { excludeClasses: ["Bicycle"] }, duration: 600 }
  const derived = { simulation_id: "modified-1", partial: { selectionFile: "/selected.json", filterableClasses: ["Car"] }, modifications: { files: ["/change.json"] } }
  const plan = simulationStartPlan({ configFile: "/derived.json", manualPath: false, appliedConfig: original, derived })
  assert.deepEqual(plan.config, { ...original, id: "modified-1", partial: derived.partial, modifications: derived.modifications })
  assert.equal(plan.body, undefined)
  assert.deepEqual(original, { loadFilter: { excludeClasses: ["Bicycle"] }, duration: 600 })
})

test("manual path and unedited scenarios start from their explicit file", () => {
  for (const args of [{ manualPath: true, appliedConfig: { duration: 1 } }, { manualPath: false }]) {
    const plan = simulationStartPlan({ configFile: "/base.json", ...args })
    assert.equal(plan.config, undefined)
    assert.deepEqual(plan.body, { configFile: "/base.json" })
  }
})
