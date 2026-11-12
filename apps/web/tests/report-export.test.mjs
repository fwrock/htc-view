import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@/lib/i18n") return { url: new URL("../lib/i18n/index.ts", import.meta.url).href, shortCircuit: true }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url.includes("/lib/i18n/messages/") && url.endsWith(".json")) return { format: "module", source: `export default ${readFileSync(new URL(url), "utf8")}`, shortCircuit: true }
    return next(url, context)
  },
})
const { panelCsv, panelLatex, reportPanel, registerPanel, collectReportPanels } = await import("../lib/metrics-export.ts")

test("exports every row and retains precision, CSV quoting and LaTeX escaping", () => {
  const rows = Array.from({ length: 1100 }, (_, i) => [`node_${i},\"A\" & 50%`, 0.000000123456789 + i, null])
  const panel = reportPanel("Full & complete", { kind: "table", columns: ["node", "value", "missing"], rows })
  assert.equal(panel.csv.split("\r\n").length, 1102)
  assert.ok(panel.csv.includes('"node_1099,""A"" & 50%"'))
  assert.ok(panel.latex.includes('node\\_1099'))
  assert.ok(panel.latex.includes('1.23456789e-7'))
  assert.ok(panel.latex.includes('\\& 50\\%'))
  assert.ok(panel.latex.includes('\\begin{longtable}'))
})

test("series exports include every timestamp and missing samples", () => {
  const data = { kind: "series", series: [{ label: "a", points: [[0, 1], [2000, 3]] }, { label: "b", points: [[1000, 2]] }] }
  const csv = panelCsv(data)
  assert.ok(csv.includes('1970-01-01T00:00:01.000Z,1000,,2'))
  const latex = panelLatex("series", data)
  assert.ok(latex.includes('1970-01-01T00:00:02.000Z'))
  assert.ok(latex.includes('epoch\\_ms'))
})

test("histogram quantiles and full matrix are available in both formats", () => {
  const data = { kind: "bins", bins: [{ label: "0-1", value: 9 }], quantiles: [{ q: "p99", v: 0.123456789 }] }
  assert.ok(panelLatex("bins", data).includes("quantile p99 & 0.123456789"))
  assert.ok(panelCsv(data).includes("quantile p99,0.123456789"))
  const matrix = { kind: "matrix", rows: ["a", "b"], cols: ["x", "y"], cells: [[1, 2], [3, 4]], rowLabel: "from", colLabel: "to" }
  assert.ok(panelCsv(matrix).includes("b,3,4"))
  assert.ok(panelLatex("matrix", matrix).includes("b & 3 & 4"))
})


test("bulk exports use registered data independently of visible table rows", () => {
  const node = { dataset: { panelTitle: "Full data" } }
  const data = { kind: "table", columns: ["row"], rows: Array.from({ length: 500 }, (_, i) => [i]) }
  const unregister = registerPanel(node, data)
  const root = { querySelectorAll: () => [node] }
  const panels = collectReportPanels(root)
  assert.equal(panels[0].data.rows.length, 500)
  assert.ok(panels[0].csv.includes("499"))
  unregister()
  assert.deepEqual(collectReportPanels(root), [])
})

const { collectReportPanelData, prepareReportPanels } = await import("../lib/metrics-export.ts")
const { collectReportSections } = await import("../lib/report-collection.ts")

test("all-section reports include the initially selected JVM tab and final Nodes tab exactly once", async () => {
  for (const original of ["jvm", "nodes", "overview"]) {
    let current = original
    const sections = ["overview", "managers", "jvm", "nodes"]
    const collected = await collectReportSections(sections, section => { current = section }, () => [current])
    assert.deepEqual(collected, sections)
  }
})

test("collection snapshots defer expensive CSV and LaTeX construction until asynchronous preparation", async () => {
  const node = { dataset: { panelTitle: "Nodes" } }
  let reads = 0
  const data = { kind: "table", columns: ["node"], get rows() { reads++; return [["node-1"], ["node-4"]] } }
  const unregister = registerPanel(node, data)
  try {
    const snapshot = collectReportPanelData({ querySelectorAll: () => [node] })
    assert.equal(reads, 0)
    const prepared = await prepareReportPanels(snapshot)
    assert.ok(reads > 0)
    assert.ok(prepared[0].csv.includes("node-4"))
    assert.ok(prepared[0].latex.includes("node-4"))
  } finally { unregister() }
})

test("cancelling report collection or preparation stops before visiting further sections or tables", async () => {
  const controller = new AbortController()
  const visited = []
  await assert.rejects(collectReportSections(["jvm", "nodes"], section => {
    visited.push(section); controller.abort()
  }, () => ["unreachable"], { signal: controller.signal }), { name: "AbortError" })
  assert.deepEqual(visited, ["jvm"])
  await assert.rejects(prepareReportPanels([{ title: "unreachable", data: { kind: "table", columns: [], rows: [] } }], { signal: controller.signal }), { name: "AbortError" })
})
