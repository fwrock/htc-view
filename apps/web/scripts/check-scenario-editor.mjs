/** Authoring API proof against tests.test_scenario_editor.make_scene's bounded fixture. */
import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { parseArgs } from "node:util"
import { documentStops, editDraft, editorRequest, newEntity, nextIdentity, undoDraft, redoDraft } from "../lib/scenario-editor.ts"

const { values } = parseArgs({ options: { scenario: { type: "string" }, revision: { type: "string" }, output: { type: "string" } } })
assert.ok(values.scenario && values.revision && values.output)
let draft = await editorRequest("/drafts", { ref: values.scenario })
const create = (kind, content) => {
  const actor = newEntity(kind, nextIdentity(draft.document), draft.document)
  actor.data.content = { ...actor.data.content, ...content }
  draft = editDraft(draft, `Add ${kind}`, { actors: [{ id: actor.id, value: actor }] })
  return actor
}
draft = editDraft(draft, "Set horizon", { meta: { simulation: { ...draft.document.simulation, endTick: 180, duration: 180 } } })
const node = create("Node", { latitude: 48, longitude: 2.002 })
const road = create("Link", { from: "2", to: node.id, length: 100 })
const returnRoad = create("Link", { from: node.id, to: "2", length: 100 })
const path = [["10", "2"], [road.id, node.id]]
create("Car", { origin: "1", destination: node.id, startTick: 2, bestRoute: path })
const busStop = create("BusStop", { nodeId: node.id, label: "New east bus stop" })
const busLine = { lineId: "B2", stopType: "bus", headwaySeconds: 30, stops: [
  { stopId: "stop-20", travelTimeFromPrevSeconds: 0 }, { stopId: documentStops(draft.document).find((stop) => stop.actorId === busStop.id).id, travelTimeFromPrevSeconds: 30 }] }
draft = editDraft(draft, "Add bus line", { lines: [{ id: busLine.lineId, value: busLine }] })
create("Bus", { origin: "1", destination: node.id, startTick: 8, label: "B2", busStops: { "20": "1", [busStop.id]: node.id }, storedBestRoute: [...path, [returnRoad.id, "2"], ["11", "1"]] })
const station = create("SubwayStation", { nodeId: node.id, name: "East metro", terminal: true })
const rail = create("RailLink", { from: "2", to: node.id, length: 100, fromStation: "31", toStation: station.id, subwayLine: "M2" })
const returnRail = create("RailLink", { from: node.id, to: "2", length: 100, fromStation: station.id, toStation: "31", subwayLine: "M2" })
const metroLine = { lineId: "M2", stopType: "subway", headwaySeconds: 30, stops: [
  { stopId: "stop-31", travelTimeFromPrevSeconds: 0 }, { stopId: documentStops(draft.document).find((stop) => stop.actorId === station.id).id, travelTimeFromPrevSeconds: 10 }] }
draft = editDraft(draft, "Add metro line", { lines: [{ id: metroLine.lineId, value: metroLine }] })
create("Subway", { origin: "2", destination: node.id, startTick: 20, line: "M2", subwayStations: { "31": "2", [station.id]: node.id }, bestRoute: [[rail.id, node.id], [returnRail.id, "2"]] })
const plan = (origin, destination, leg) => [
  { kind: "Activity", activityType: "home", nodeId: origin, endTime: { kind: "AtTick", tick: 0 } }, leg,
  { kind: "Activity", activityType: "destination", nodeId: destination, endTime: { kind: "AtTick", tick: 180 } }]
create("Person", { originalPlan: plan("1", node.id, { kind: "WalkLeg", originNodeId: "1", destinationNodeId: node.id, precomputedRoute: path }) })
create("Person", { originalPlan: plan("1", node.id, { kind: "TransitLeg", mode: "Bus", line: "B2",
  boardingStop: { actorId: "20", nodeId: "1", actorClassType: "hybrid.actor.BusStop" }, alightingStop: { actorId: busStop.id, nodeId: node.id, actorClassType: "hybrid.actor.BusStop" } }) })
create("Person", { originalPlan: plan("2", node.id, { kind: "TransitLeg", mode: "Subway", line: "M2",
  boardingStop: { actorId: "31", nodeId: "2", actorClassType: "hybrid.actor.SubwayStation" }, alightingStop: { actorId: station.id, nodeId: node.id, actorClassType: "hybrid.actor.SubwayStation" } }) })
assert.deepEqual(redoDraft(undoDraft(draft)).document, draft.document)
draft = await editorRequest(`/drafts/${draft.id}`, { version: draft.version, document: draft.document, history: draft.history }, "PUT")
const reopened = await editorRequest(`/drafts/${draft.id}`)
assert.deepEqual(reopened.history, draft.history)
const report = await editorRequest(`/drafts/${draft.id}/validate`, {})
assert.equal(report.ok, true, JSON.stringify(report))
const published = await editorRequest(`/drafts/${draft.id}/publish`, { version: draft.version, revision: values.revision })
await assert.rejects(() => editorRequest(`/drafts/${draft.id}`, { version: draft.version, document: draft.document, history: draft.history }, "PUT"))
const evidence = { status: "passed", draft_id: draft.id, published: published.ref, validation: report,
  persisted_history_actions: draft.history.past.length, undo_redo: "passed", stale_save_rejected: true, browser_interaction: "not tested" }
await writeFile(values.output, JSON.stringify(evidence, null, 2) + "\n")
console.log(JSON.stringify(evidence, null, 2))
