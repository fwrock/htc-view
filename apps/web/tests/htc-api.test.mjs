import test from "node:test"
import assert from "node:assert/strict"
import { getSimulationStatus, putSimulationConfig, setHtcApiBase } from "../lib/htc-api.ts"

test("status GET avoids JSON preflight headers, while config mutations remain JSON", async () => {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return new Response(JSON.stringify({ status: "Idle" }), { status: 200 })
  }
  try {
    setHtcApiBase("http://localhost:9804/api/v1")
    await getSimulationStatus()
    await putSimulationConfig({ name: "test", duration: 10 })
    assert.equal(calls[0].init.headers.has("Content-Type"), false)
    assert.equal(calls[1].init.headers.get("Content-Type"), "application/json")
    assert.equal(JSON.parse(calls[1].init.body).name, "test")
  } finally {
    globalThis.fetch = original
  }
})
