import test from "node:test"
import assert from "node:assert/strict"
import { estimationInputs, roadMetadataError, scenarioRoadFile } from "../lib/simedape-estimation.ts"

test("an interrupted estimation restores partial, variants and comparison reference from durable metadata", () => {
  const variants = ["avg", "pca_sp"]
  const run = {
    status: "failed",
    name: "tl_1pct_meso · estimativa ← random-p05",
    meta: { stage_params: {
      estimation_variants: { second_scenario_dir: "tl_1pct_meso_random_p05", variants },
      scenario_metrics: { reference_dir: "tl_1pct_meso_modified_full" },
    } },
  }
  const restored = estimationInputs(run)
  assert.deepEqual(restored, {
    partial: "tl_1pct_meso_random_p05", reference: "tl_1pct_meso_modified_full", variants,
  })
  restored.variants.push("sample")
  assert.equal(variants.length, 2)
})

test("a base comparison clears the previously selected alternative reference", () => {
  assert.deepEqual(estimationInputs({ meta: { stage_params: {
    estimation_variants: { second_scenario_dir: " /data/partial/ ", variants: ["avg"] },
  } } }), { partial: "/data/partial/", reference: "", variants: ["avg"] })
})

test("legacy estimates retain their partial without inventing modern variants", () => {
  assert.deepEqual(estimationInputs({ meta: { stage_params: {
    estimation: { second_scenario_dir: "partial-05", methods: ["avg"] },
  } } }), { partial: "partial-05", reference: "" })
})

test("missing or invalid saved inputs never guess the partial from the run title or output path", () => {
  for (const run of [null, { meta: {} }, { name: "estimate ← random-p05", meta: { output_dir: "/model/estimativa-random-p05" } },
    { meta: { stage_params: { estimation_variants: { second_scenario_dir: "  " } } } },
    { meta: { stage_params: { estimation_variants: { second_scenario_dir: 5 } } } }]) {
    assert.equal(estimationInputs(run), null)
  }
})

test("estimation requires a road catalogue and accepts a repaired CSV", () => {
  assert.ok(roadMetadataError(""))
  assert.ok(roadMetadataError("   "))
  assert.equal(roadMetadataError(" /scenarios/tl/streets-simedape-repaired.csv "), null)
})

test("applying the same scenario preserves a repaired path while a different scenario clears it", () => {
  assert.equal(scenarioRoadFile("/repaired.csv", "tl", "tl", ""), "/repaired.csv")
  assert.equal(scenarioRoadFile("/repaired.csv", "tl", "other", ""), "")
  assert.equal(scenarioRoadFile("/repaired.csv", "tl", "other", "/other/streets.csv"), "/other/streets.csv")
})
