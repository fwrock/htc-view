import test from "node:test"
import assert from "node:assert/strict"
import { listBundledScenarios } from "../components/live/data/listBundledScenarios.ts"

test("live selector includes mounted Toulouse geometry alongside bundled demos", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => new Response(JSON.stringify(
    url === "/data/scenarios.json"
      ? ["demo", "duplicate"]
      : { scenarios: [
          { name: "tl_1pct_meso", hasGeometry: true },
          { name: "duplicate", hasGeometry: true },
          { name: "no-map", hasGeometry: false },
        ] }
  )))
  assert.deepEqual(await listBundledScenarios(), ["demo", "duplicate", "tl_1pct_meso"])
})

test("bundled demos remain selectable when the scenario bridge is unavailable", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url === "/api/replay") throw new Error("offline")
    return new Response(JSON.stringify(["demo"]))
  })
  assert.deepEqual(await listBundledScenarios(), ["demo"])
})

test("invalid catalog responses do not crash the map selector", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => new Response(JSON.stringify(
    url === "/api/replay" ? { scenarios: {} } : ["demo", 42]
  )))
  assert.deepEqual(await listBundledScenarios(), ["demo"])
})
