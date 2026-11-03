import test from "node:test"
import assert from "node:assert/strict"
import { editDraft, undoDraft, redoDraft, nextIdentity, documentStops, newEntity, replaceSplitRoadReferences } from "../lib/scenario-editor.ts"

const fixture = () => ({ id: "draft", base_ref: "demo:base", version: 1, published: [], name: "Test",
  history: { past: [], future: [] }, document: { schema: "htc.scenario-draft.v1", name: "Test",
    map_mode: "standalone", road_network: null, simulation: { endTick: 120 }, transit_stops: [], lines: [], actors: [
      { id: "9007199254740993", typeActor: "hybrid.actor.Node", data: { dataType: "NodeState", content: { latitude: 48, longitude: 2 } } },
      { id: "2", typeActor: "hybrid.actor.Node", data: { dataType: "NodeState", content: { latitude: 48, longitude: 2.01 } } },
      { id: "3", typeActor: "hybrid.actor.BusStation", data: { dataType: "BusStationState", content: { buses: [{ actorId: "9007199254741000" }] } } },
    ] } })

test("delete and undo restore exact entity order and 64-bit identities", () => {
  const original = fixture()
  const removed = editDraft(original, "Delete", { actors: [{ id: "9007199254740993", value: null }, { id: "2", value: null }] })
  assert.equal(removed.document.actors.length, 1)
  assert.deepEqual(undoDraft(removed).document, original.document)
  assert.deepEqual(redoDraft(undoDraft(removed)).document, removed.document)
})

test("a topology transaction and a new branch preserve atomic undo/redo semantics", () => {
  const original = fixture()
  const changed = editDraft(original, "Connect", { actors: [{ id: "4", value: newEntity("Link", "4", original.document) }, { id: "5", value: newEntity("Car", "5", original.document) }] })
  assert.equal(changed.document.actors.length, 5)
  assert.deepEqual(undoDraft(changed).document, original.document)
  const branch = editDraft(undoDraft(changed), "Rename", { meta: { name: "Branch" } })
  assert.equal(branch.history.future.length, 0)
  assert.equal(redoDraft(branch).document.name, "Branch")
})

test("draft reload retains undo/redo and explicit OSM detachment is reversible", () => {
  const original = fixture(); original.document.map_mode = "osm"; original.document.road_network = { links: {} }
  const changed = editDraft(original, "Detach", { meta: { map_mode: "standalone" } })
  const restored = JSON.parse(JSON.stringify(changed))
  assert.deepEqual(undoDraft(restored).document, original.document)
  assert.equal(restored.document.road_network.links != null, true)
})

test("new identities reserve dispatched vehicles as well as static actors without Number rounding", () => {
  assert.equal(nextIdentity(fixture().document), "9007199254741001")
})

test("new stops use stable external keys and editable road templates keep MESO explicit", () => {
  const document = fixture().document
  const stop = newEntity("BusStop", "9007199254741001", document)
  const withStop = { ...document, actors: [...document.actors, stop] }
  assert.equal(documentStops(withStop)[0].id, "editor-stop-9007199254741001")
  assert.equal(documentStops(withStop)[0].nodeId, "9007199254740993")
  assert.equal(newEntity("Link", "6", document).data.content.simulationMode, "MESO")
})

test("splitting a road repairs nested walking routes, vehicle routes and signal approaches", () => {
  const person = newEntity("Person", "100", fixture().document)
  person.data.content.originalPlan = [{ kind: "WalkLeg", precomputedRoute: [["7", "2"]] }]
  const changed = replaceSplitRoadReferences(person, "7", "9", "8", "2")
  assert.deepEqual(changed.data.content.originalPlan[0].precomputedRoute, [["7", "8"], ["9", "2"]])
  assert.deepEqual(person.data.content.originalPlan[0].precomputedRoute, [["7", "2"]])
  const signal = newEntity("TrafficSignal", "101", fixture().document)
  signal.data.content.phases = [{ origin: "7", greenStart: 0, greenDuration: 10 }]
  assert.equal(replaceSplitRoadReferences(signal, "7", "9", "8", "2").data.content.phases[0].origin, "9")
})
