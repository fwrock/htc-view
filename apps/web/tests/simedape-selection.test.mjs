import test from "node:test"
import assert from "node:assert/strict"
import { selectionRunStamp } from "../lib/simedape-selection.ts"

test("parallel selections at the same timestamp get independent safe output directories", () => {
  const values = Array.from({ length: 1000 }, () => selectionRunStamp("20261110-205900"))
  assert.equal(new Set(values).size, values.length)
  assert.ok(values.every(value => /^20261110-205900-[a-f0-9]{16}$/.test(value)))
})
