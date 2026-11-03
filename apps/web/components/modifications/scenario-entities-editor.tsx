"use client"

import { useI18n } from "@/components/i18n-provider"

import { useEffect, useState } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { Button } from "@workspace/ui/components/button"
import { getAllScenarios } from "@/lib/simedape-api"
import { documentStops, editDraft, editorRequest, entityKind, entityName, newEntity, nextIdentity, redoDraft, undoDraft, replaceSplitRoadReferences,
  type Draft, type Entity, type Patch, type TransitLine, type Validation } from "@/lib/scenario-editor"
import { editorInput, entityLabels, EntitySelect, ScenarioEntityForm, ScenarioLineForm } from "./scenario-entity-form"

const NetworkMap = dynamic(() => import("./scenario-network-map").then((module) => module.ScenarioNetworkMap), { ssr: false,
  loading: function LoadingMap() {
  const { t: translateText } = useI18n()
 return <p className="p-6 text-xs">{translateText("Carregando mapa…")}</p> } })
const signature = (draft: Draft) => JSON.stringify([draft.document, draft.history])
const cacheKey = (id: string) => `htc-scenario-draft:${id}`

export function ScenarioEntitiesEditor({ initialRef, active = true }: { initialRef?: string; active?: boolean }) {
  const { t: translateText } = useI18n()

  const [ref, setRef] = useState(initialRef ?? "")
  const [scenarios, setScenarios] = useState<{ ref: string; title?: string; name: string }[]>([])
  const [drafts, setDrafts] = useState<Pick<Draft, "id" | "base_ref" | "name" | "version">[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saved, setSaved] = useState("")
  const [selection, setSelection] = useState<string | null>(null)
  const [newActor, setNewActor] = useState<Entity | null>(null)
  const [newLine, setNewLine] = useState<TransitLine | null>(null)
  const [formDirty, setFormDirty] = useState(false)
  const [formVersion, setFormVersion] = useState(0)
  const [category, setCategory] = useState("Node")
  const [search, setSearch] = useState("")
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const [validation, setValidation] = useState<Validation | null>(null)
  const [revision, setRevision] = useState("")
  const [showDemand, setShowDemand] = useState(false)
  const [od, setOd] = useState({ origin: "", destination: "", count: 10, start: 0, interval: 5, kind: "Car", line: "" })
  const document = draft?.document
  const dirty = !!draft && signature(draft) !== saved
  useEffect(() => {
    let live = true
    getAllScenarios().then((data) => { if (live) setScenarios(data.scenarios) }).catch((error) => { if (live) setMessage(error.message) })
    editorRequest<{ drafts: typeof drafts }>("/drafts").then((data) => { if (live) setDrafts(data.drafts) }).catch((error) => { if (live) setMessage(error.message) })
    return () => { live = false }
  }, [])
  useEffect(() => {
    if (!draft) return
    const timer = setTimeout(() => {
      try { localStorage.setItem(cacheKey(draft.id), JSON.stringify(draft)) }
      catch { setMessage("A recuperação local está cheia ou indisponível. Salve o rascunho no servidor.") }
    }, 250)
    return () => clearTimeout(timer)
  }, [draft])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty || formDirty) { event.preventDefault(); event.returnValue = "" } }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty, formDirty])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (!active || !draft || busy || formDirty || target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "") || !(event.ctrlKey || event.metaKey)) return
      if (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y") {
        event.preventDefault()
        const redo = event.shiftKey || event.key.toLowerCase() === "y"
        setDraft(redo ? redoDraft(draft) : undoDraft(draft)); setValidation(null); setFormVersion((n) => n + 1)
      }
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [active, draft, busy, formDirty])
  const clearForm = () => { setFormDirty(false); setNewActor(null); setNewLine(null); setFormVersion((n) => n + 1) }
  const canLeaveForm = () => {
    if (formDirty) { setMessage("Aplique ou descarte os campos da entidade antes de continuar."); return false }
    return !busy
  }
  const select = (id: string) => { if (canLeaveForm()) { clearForm(); setSelection(id) } }
  function accept(value: Draft, recover = true) {
    setSaved(signature(value)); setRef(value.base_ref); setSelection(null); clearForm(); setValidation(null)
    let local: Draft | null = null
    try { local = JSON.parse(localStorage.getItem(cacheKey(value.id)) ?? "null") } catch { /* no local recovery */ }
    if (recover && local?.id === value.id && signature(local) !== signature(value)) {
      setDraft(local)
      setMessage(local.version === value.version ? "Rascunho local recuperado. Salve para sincronizar com o servidor." : "Há alterações locais e uma versão diferente no servidor. Exporte seu rascunho antes de reabrir a versão do servidor.")
    } else { setDraft(value); setMessage("") }
  }
  async function act(work: () => Promise<void>) {
    setBusy(true); setMessage("")
    try { await work() } catch (error) { setMessage((error as Error).message) } finally { setBusy(false) }
  }
  async function save(): Promise<Draft> {
    if (!draft) throw new Error("Abra um rascunho")
    const result = await editorRequest<Draft>(`/drafts/${draft.id}`, { version: draft.version, document: draft.document, history: draft.history }, "PUT")
    setDraft(result); setSaved(signature(result))
    try { localStorage.setItem(cacheKey(result.id), JSON.stringify(result)) } catch { /* server save succeeded */ }
    return result
  }
  function change(label: string, patch: Patch) {
    if (!draft || busy) return
    setDraft(editDraft(draft, label, patch)); setValidation(null); setFormDirty(false); setFormVersion((n) => n + 1)
    setNewActor(null); setNewLine(null)
  }
  async function calculate(actor: Entity): Promise<Entity> {
    const s = actor.data.content
    const result = await editorRequest<{ route: string[][] }>(`/drafts/${draft!.id}/route`, { document, origin: s.origin, destination: s.destination, rail: entityKind(actor) === "Subway" })
    const cls = entityKind(actor)
    if (["Bus", "Subway"].includes(cls)) {
      const back = await editorRequest<{ route: string[][] }>(`/drafts/${draft!.id}/route`, { document, origin: s.destination, destination: s.origin, rail: cls === "Subway" })
      result.route.push(...back.route)
    }
    return { ...actor, data: { ...actor.data, content: { ...s, [cls === "Bus" ? "storedBestRoute" : "bestRoute"]: result.route } } }
  }
  function add(kind: string) {
    if (!document || !canLeaveForm()) return
    clearForm(); setSelection(null); setNewActor(newEntity(kind, nextIdentity(document), document)); setFormDirty(true)
  }
  function addNode(longitude: number, latitude: number) {
    if (!document || !canLeaveForm()) return
    const actor = newEntity("Node", nextIdentity(document), document)
    actor.data.content = { ...actor.data.content, longitude, latitude }
    change("Adicionar nó", { actors: [{ id: actor.id, value: actor }] }); setSelection(actor.id)
  }
  function connect(from: string, to: string, rail: boolean) {
    if (!document || !canLeaveForm()) return
    const actor = newEntity(rail ? "RailLink" : "Link", nextIdentity(document), document)
    const source = document.actors.find((node) => node.id === from), target = document.actors.find((node) => node.id === to)
    if (!source || !target) return setMessage("O nó escolhido não existe mais. Selecione novamente a origem e o destino.")
    const a = source.data.content, b = target.data.content
    const radians = Math.PI / 180, dLat = (Number(b.latitude) - Number(a.latitude)) * radians, dLon = (Number(b.longitude) - Number(a.longitude)) * radians
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(Number(a.latitude) * radians) * Math.cos(Number(b.latitude) * radians) * Math.sin(dLon / 2) ** 2
    actor.data.content = { ...actor.data.content, from, to, length: Math.max(1, 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))) }
    if (rail) { actor.data.content.fromStation = document.actors.find((a) => entityKind(a) === "SubwayStation" && String(a.data.content.nodeId) === from)?.id ?? "0"
      actor.data.content.toStation = document.actors.find((a) => entityKind(a) === "SubwayStation" && String(a.data.content.nodeId) === to)?.id ?? "0" }
    change(rail ? "Conectar trilho" : "Conectar via", { actors: [{ id: actor.id, value: actor }] }); setSelection(actor.id)
  }
  function splitRoad(actor: Entity) {
    if (!document || document.map_mode === "osm" || !canLeaveForm()) return
    const s = actor.data.content, a = document.actors.find((a) => a.id === String(s.from)), b = document.actors.find((a) => a.id === String(s.to))
    if (s.junctionGeometry || s.downstreamLookahead) return setMessage("Esta via usa geometria/conexões MICRO avançadas. Reconfigure essas referências antes de dividir.")
    if (!a || !b) return setMessage("Corrija os nós da via antes de dividir.")
    const node = newEntity("Node", nextIdentity(document), document), secondId = (BigInt(node.id) + 1n).toString()
    node.data.content = { ...node.data.content, latitude: (Number(a.data.content.latitude) + Number(b.data.content.latitude)) / 2, longitude: (Number(a.data.content.longitude) + Number(b.data.content.longitude)) / 2 }
    const first = structuredClone(actor), second = structuredClone(actor); second.id = secondId
    first.data.content = { ...s, to: node.id, length: Number(s.length) / 2 }
    second.data.content = { ...s, from: node.id, length: Number(s.length) / 2 }
    const edits: NonNullable<Patch["actors"]> = [{ id: actor.id, value: first }, { id: node.id, value: node }, { id: second.id, value: second }]
    for (const other of document.actors) {
      if (other.id === actor.id) continue
      const updated = replaceSplitRoadReferences(other, actor.id, second.id, node.id, String(s.to))
      if (JSON.stringify(updated) !== JSON.stringify(other)) edits.push({ id: other.id, value: updated })
    }
    change("Dividir via e atualizar rotas/sinais", { actors: edits }); setSelection(node.id)
  }
  async function createDeparture(line: TransitLine) {
    if (!document || !draft) return
    const stops = documentStops(document)
    const sequence = line.stops.map((entry) => stops.find((stop) => stop.id === entry.stopId))
    if (sequence.length < 2 || sequence.some((stop) => !stop)) throw new Error("Defina pelo menos duas paradas válidas na linha")
    const first = sequence[0]!, last = sequence.at(-1)!
    const result = await editorRequest<{ route: string[][] }>(`/drafts/${draft.id}/route`, {
      document, origin: first.nodeId, destination: last.nodeId, via: sequence.slice(1, -1).map((s) => s!.nodeId), rail: line.stopType === "subway" })
    const returning = await editorRequest<{ route: string[][] }>(`/drafts/${draft.id}/route`, { document, origin: last.nodeId, destination: first.nodeId,
      via: sequence.slice(1, -1).reverse().map((s) => s!.nodeId), rail: line.stopType === "subway" })
    result.route.push(...returning.route)
    const actor = newEntity(line.stopType === "bus" ? "Bus" : "Subway", nextIdentity(document), document)
    actor.data.content = { ...actor.data.content, origin: first.nodeId, destination: last.nodeId,
      [line.stopType === "bus" ? "label" : "line"]: line.lineId,
      [line.stopType === "bus" ? "storedBestRoute" : "bestRoute"]: result.route,
      [line.stopType === "bus" ? "busStops" : "subwayStations"]: Object.fromEntries(sequence.map((stop) => [stop!.actorId, stop!.nodeId])) }
    // act() disables commands while network work is in flight; commit this completed operation directly.
    setDraft(editDraft(draft, `Criar partida ${line.lineId}`, { actors: [{ id: actor.id, value: actor }] })); setValidation(null); setSelection(actor.id); setCategory(entityKind(actor))
  }
  async function applyLine(previous: TransitLine, value: TransitLine) {
    if (!draft || !document) return
    if (!value.lineId.trim() || (value.lineId !== previous.lineId && document.lines.some((line) => line.lineId === value.lineId))) throw new Error("Escolha um nome de linha único.")
    const lookup = documentStops(document)
    const stops = value.stops.map((stop) => lookup.find((candidate) => candidate.id === stop.stopId))
    const edits: NonNullable<Patch["actors"]> = []
    const services = newLine ? [] : document.actors.filter((actor) => {
      const s = actor.data.content
      return (entityKind(actor) === "Bus" && s.label === previous.lineId) || (entityKind(actor) === "Subway" && s.line === previous.lineId)
        || (entityKind(actor) === "BusStation" && Array.isArray(s.buses) && (s.buses as { label: string }[]).some((bus) => bus.label === previous.lineId))
        || (entityKind(actor) === "SubwayStation" && !!(s.lines as Record<string, unknown> | undefined)?.[previous.lineId])
    })
    if (services.length && (stops.length < 2 || stops.some((stop) => !stop))) throw new Error("Linhas com serviços precisam de duas paradas válidas antes de atualizar suas partidas.")
    if (services.length && previous.stopType !== value.stopType) throw new Error("Remova ou reconfigure as partidas existentes antes de mudar o modo da linha.")
    if (services.length) {
      const first = stops[0]!, last = stops.at(-1)!
      const response = await editorRequest<{ route: string[][] }>(`/drafts/${draft.id}/route`, { document, origin: first.nodeId,
        destination: last.nodeId, via: stops.slice(1, -1).map((stop) => stop!.nodeId), rail: value.stopType === "subway" })
      const returning = await editorRequest<{ route: string[][] }>(`/drafts/${draft.id}/route`, { document, origin: last.nodeId, destination: first.nodeId,
        via: stops.slice(1, -1).reverse().map((stop) => stop!.nodeId), rail: value.stopType === "subway" })
      response.route.push(...returning.route)
      for (const service of services) {
        const actor = structuredClone(service), s = actor.data.content, cls = entityKind(actor)
        if (cls === "Bus" || cls === "Subway") Object.assign(s, { origin: first.nodeId, destination: last.nodeId,
          [cls === "Bus" ? "label" : "line"]: value.lineId, [cls === "Bus" ? "storedBestRoute" : "bestRoute"]: response.route,
          [cls === "Bus" ? "busStops" : "subwayStations"]: Object.fromEntries(stops.map((stop) => [stop!.actorId, stop!.nodeId])) })
        if (cls === "BusStation") { s.interval = value.headwaySeconds; s.busStops = Object.fromEntries(stops.map((stop) => [stop!.actorId, stop!.nodeId])); s.buses = (s.buses as Record<string, unknown>[]).map((bus) => bus.label === previous.lineId ? { ...bus, label: value.lineId } : bus) }
        if (cls === "SubwayStation") {
          const intervals = { ...(s.lines as Record<string, unknown>) }, trains = { ...(s.subways as Record<string, unknown>) }, routes = { ...(s.linesRoute as Record<string, unknown>) }
          const dispatch = await editorRequest<{ route: string[][] }>(`/drafts/${draft.id}/route`, { document, origin: String(s.nodeId), destination: last.nodeId,
            via: stops.slice(0, -1).map((stop) => stop!.nodeId), rail: true })
          const back = await editorRequest<{ route: string[][] }>(`/drafts/${draft.id}/route`, { document, origin: last.nodeId, destination: String(s.nodeId),
            via: stops.slice(0, -1).reverse().map((stop) => stop!.nodeId), rail: true })
          dispatch.route.push(...back.route)
          const entries = dispatch.route.map(([rail, node]) => ({ railLinkId: rail, stationNode: { nodeId: node,
            stationId: document.actors.find((actor) => entityKind(actor) === "RailLink" && actor.id === rail)?.data.content.toStation ?? "0" } }))
          const fleet = (trains[previous.lineId] ?? []) as Record<string, unknown>[]
          delete intervals[previous.lineId]; delete trains[previous.lineId]; delete routes[previous.lineId]
          s.lines = { ...intervals, [value.lineId]: { interval: value.headwaySeconds, nextTick: 0 } }
          s.subways = { ...trains, [value.lineId]: fleet.map((train) => ({ ...train, line: value.lineId })) }
          s.linesRoute = { ...routes, [value.lineId]: entries }
        }
        edits.push({ id: actor.id, value: actor })
      }
    }
    const patch: Patch = { actors: edits, lines: [...(!newLine && previous.lineId !== value.lineId ? [{ id: previous.lineId, value: null }] : []), { id: value.lineId, value }] }
    setDraft(editDraft(draft, "Editar linha e sincronizar serviços", patch)); setValidation(null); clearForm(); setSelection(`line:${value.lineId}`)
  }
  async function generateDemand() {
    if (!draft || !document) return
    if (!Number.isInteger(od.count) || od.count < 1 || od.count > 1000 || !Number.isInteger(od.interval) || !Number.isInteger(od.start) || od.interval < 0 || od.start < 0) throw new Error("Use 1–1000 partidas e tempos inteiros não negativos")
    if (od.start + (od.count - 1) * od.interval > Number(document.simulation.endTick)) throw new Error("As partidas devem caber no horizonte do cenário.")
    const transit = ["BusPassenger", "SubwayPassenger"].includes(od.kind)
    const line = transit ? document.lines.find((line) => line.lineId === od.line && line.stopType === (od.kind === "BusPassenger" ? "bus" : "subway")) : null
    const lookup = documentStops(document)
    const first = line ? lookup.find((stop) => stop.id === line.stops[0]?.stopId) : undefined
    const last = line ? lookup.find((stop) => stop.id === line.stops.at(-1)?.stopId) : undefined
    if (transit && (!line || !first || !last || line.stops.length < 2)) throw new Error("Escolha uma linha válida com pelo menos duas paradas.")
    const origin = transit ? first!.nodeId : od.origin, destination = transit ? last!.nodeId : od.destination
    const result = transit ? { route: [] } : await editorRequest<{ route: string[][] }>(`/drafts/${draft.id}/route`, { document, origin, destination })
    let id = BigInt(nextIdentity(document))
    const actors: NonNullable<Patch["actors"]> = []
    for (let n = 0; n < od.count; n++, id++) {
      const actor = newEntity(transit ? "Person" : od.kind, id.toString(), document), departure = od.start + n * od.interval
      actor.data.content = { ...actor.data.content, startTick: departure }
      if (od.kind === "Person" || transit) actor.data.content.originalPlan = [
        { kind: "Activity", activityType: "home", nodeId: origin, endTime: { kind: "AtTick", tick: departure } },
        transit ? { kind: "TransitLeg", mode: line!.stopType === "bus" ? "Bus" : "Subway", line: line!.lineId,
          boardingStop: { actorId: first!.actorId, nodeId: origin, actorClassType: `hybrid.actor.${line!.stopType === "bus" ? "BusStop" : "SubwayStation"}` },
          alightingStop: { actorId: last!.actorId, nodeId: destination, actorClassType: `hybrid.actor.${line!.stopType === "bus" ? "BusStop" : "SubwayStation"}` } }
          : { kind: "WalkLeg", originNodeId: origin, destinationNodeId: destination, precomputedRoute: result.route },
        { kind: "Activity", activityType: "destination", nodeId: destination, endTime: { kind: "AtTick", tick: Number(document.simulation.endTick) } }]
      else actor.data.content = { ...actor.data.content, origin, destination, bestRoute: result.route }
      actors.push({ id: actor.id, value: actor })
    }
    setDraft(editDraft(draft, `Gerar ${od.count} partidas ${od.kind}`, { actors })); setValidation(null); setShowDemand(false); setCategory(transit ? "Person" : od.kind)
  }
  const actor = newActor ?? document?.actors.find((a) => a.id === selection)
  const line = newLine ?? (selection?.startsWith("line:") ? document?.lines.find((l) => l.lineId === selection.slice(5)) : undefined)
  const locked = busy || formDirty
  const hasUnpublished = dirty || formDirty
  return <section className="flex flex-col gap-4" aria-label={translateText("Editor de entidades e mapa")}>
    <p className="text-xs text-muted-foreground">{translateText("1. Escolha o cenário e crie um rascunho. 2. Edite no mapa ou na lista. 3. Valide e publique uma nova revisão. O cenário base é preservado.")}</p>
    <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs">{translateText("Cenário base")}<select className={editorInput} value={ref} disabled={hasUnpublished} onChange={(event) => { setRef(event.target.value); setDraft(null); setSelection(null); clearForm(); setValidation(null) }}><option value="">{translateText("Selecione…")}</option>{scenarios.map((s) => <option key={s.ref} value={s.ref}>{translateText(s.title ?? s.name)} · {translateText(s.ref)}</option>)}</select></label>
      <div className="flex items-end gap-2"><Button size="sm" disabled={!ref || hasUnpublished} onClick={() => void act(async () => {
        const created = await editorRequest<Draft>("/drafts", { ref }); accept(created, false); setRevision("")
        setDrafts((items) => [created, ...items]); setMessage("Rascunho criado. Clique em uma entidade para começar.")
      })}>{translateText("Criar rascunho")}</Button>
      <select aria-label={translateText("Abrir rascunho")} className={editorInput} disabled={hasUnpublished} value={draft?.id ?? ""} onChange={(event) => { if (event.target.value) void act(async () => accept(await editorRequest<Draft>(`/drafts/${event.target.value}`))) }}>
        <option value="">{translateText("Abrir rascunho salvo…")}</option>{drafts.map((d) => <option key={d.id} value={d.id}>{translateText(d.name)} · {translateText(d.base_ref)}</option>)}</select></div>
    </fieldset>
    {message && <p className="rounded-sm border p-3 text-xs" role="status">{translateText(message)}</p>}
    {draft && document && <>
      <div className="flex flex-wrap items-center gap-2 rounded-sm border p-3 text-xs">
        <span>{translateText(draft.base_ref)}{translateText(" · versão ")}{translateText(draft.version)} · {dirty ? translateText("Alterações locais") : translateText("Salvo no servidor")}</span>
        <Button size="sm" variant="outline" disabled={locked || !draft.history.past.length} title={translateText(draft.history.past.at(-1)?.label)} onClick={() => { setDraft(undoDraft(draft)); setValidation(null); clearForm() }}>{translateText("Desfazer")}</Button>
        <Button size="sm" variant="outline" disabled={locked || !draft.history.future.length} title={translateText(draft.history.future[0]?.label)} onClick={() => { setDraft(redoDraft(draft)); setValidation(null); clearForm() }}>{translateText("Refazer")}</Button>
        <Button size="sm" disabled={locked} onClick={() => void act(async () => { await save(); setMessage("Rascunho e histórico salvos no servidor.") })}>{translateText("Salvar rascunho")}</Button>
        {dirty && <Button size="sm" variant="ghost" disabled={locked} onClick={() => void act(async () => {
          const restored = await editorRequest<Draft>(`/drafts/${draft.id}`)
          try { localStorage.setItem(`${cacheKey(draft.id)}:discarded`, JSON.stringify(draft)) } catch { /* export remains available */ }
          accept(restored, false); localStorage.setItem(cacheKey(draft.id), JSON.stringify(restored)); setMessage("Edição local descartada; versão atual do servidor reaberta.")
        })}>{translateText("Descartar edição local e reabrir salvo")}</Button>}
        <Button size="sm" variant="outline" disabled={locked} onClick={() => void act(async () => setValidation(await editorRequest<Validation>(`/drafts/${draft.id}/validate`, { document }))) }>{translateText("Validar")}</Button>
        <button type="button" className="underline" onClick={() => {
          const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" }))
          const anchor = window.document.createElement("a"); anchor.href = url; anchor.download = `draft-${draft.id}.json`; anchor.click(); URL.revokeObjectURL(url)
        }}>{translateText("Exportar rascunho")}</button>
        <span className="text-muted-foreground">{translateText("Recuperação local automática · até 100 ações no histórico")}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs">{translateText("Título da revisão")}<input className={editorInput} value={document.name} disabled={locked} onChange={(event) => change("Alterar título", { meta: { name: event.target.value } })} /></label>
        <div className="flex items-end gap-2 text-xs"><span>{document.map_mode === "osm" ? translateText("Vinculado à fonte OSM") : translateText("Rede independente")}</span>
          {document.map_mode === "osm" && <Button size="sm" variant="outline" disabled={locked} onClick={() => change("Converter revisão para rede independente", { meta: { map_mode: "standalone" } })}>{translateText("Tornar esta revisão independente")}</Button>}
        </div></div>
      {document.map_mode === "osm" && <p className="text-xs text-muted-foreground">{translateText("A edição ocorre sobre o OpenStreetMap. Vias preservam a geometria e a identidade da fonte. Para criar/mover nós ou redesenhar vias livremente, torne a revisão independente. Essa ação também pode ser desfeita.")}</p>}
      {active && <NetworkMap key={draft.id} document={document} selected={selection} onSelect={select} onNode={addNode} onConnect={connect} onMove={(id, longitude, latitude) => {
        if (!canLeaveForm()) return
        const node = document.actors.find((a) => a.id === id)!
        change("Mover nó", { actors: [{ id, value: { ...node, data: { ...node.data, content: { ...node.data.content, longitude, latitude } } } }] })
      }} />}
      <div className="grid items-start gap-4 lg:grid-cols-[280px_1fr]">
        <div className="flex flex-col gap-2">
          <label className="text-xs">{translateText("Entidades")}<select className={editorInput} value={category} onChange={(event) => setCategory(event.target.value)}>{Object.entries(entityLabels).map(([key, label]) => <option value={key} key={key}>{translateText(label)} ({translateText(document.actors.filter((a) => entityKind(a) === key).length)})</option>)}<option value="lines">{translateText("Linhas (")}{translateText(document.lines.length)})</option></select></label>
          <input aria-label={translateText("Buscar entidade")} className={editorInput} placeholder={translateText("Buscar por ID ou nome")} value={search} onChange={(event) => setSearch(event.target.value)} />
          <Button size="sm" variant="outline" disabled={locked || (document.map_mode === "osm" && ["Node", "Link"].includes(category))} onClick={() => {
            if (category === "lines") { clearForm(); setNewLine({ lineId: "", stopType: "bus", headwaySeconds: 600, stops: [] }); setFormDirty(true); setSelection(null) }
            else add(category)
          }}>+ {category === "lines" ? translateText("Linha") : translateText(entityLabels[category])}</Button>
          <div className="max-h-80 overflow-y-auto rounded-sm border text-xs">
            {category === "lines" ? document.lines.filter((line) => line.lineId.toLowerCase().includes(search.toLowerCase())).map((line) => <button type="button" key={line.lineId} className={`block w-full border-b p-2 text-left ${selection === `line:${line.lineId}` ? "bg-primary/10" : "hover:bg-muted"}`} onClick={() => select(`line:${line.lineId}`)}>{translateText(line.lineId)} · {translateText(line.stopType)}</button>)
              : document.actors.filter((a) => entityKind(a) === category && `${a.id} ${entityName(a)}`.toLowerCase().includes(search.toLowerCase())).map((a) => <button type="button" key={a.id} className={`block w-full border-b p-2 text-left ${selection === a.id ? "bg-primary/10" : "hover:bg-muted"}`} onClick={() => select(a.id)}>{translateText(entityName(a))}{entityName(a) !== a.id ? translateText(" · {0}", { 0: a.id }) : translateText("")}</button>)}
          </div>
          <Button size="sm" variant="outline" disabled={locked} onClick={() => setShowDemand(!showDemand)}>{translateText("Gerar demanda OD")}</Button>
          <details className="text-xs"><summary>{translateText("Histórico de edição")}</summary><ol className="mt-2 list-decimal pl-5">{draft.history.past.map((action, i) => <li key={i}>{translateText(action.label)}</li>)}</ol></details>
        </div>
        <fieldset disabled={busy} className="min-w-0 rounded-sm border p-4">
          {actor ? <>
            {document.map_mode === "osm" && document.road_network?.links[actor.id] && <p className="mb-3 rounded-sm border p-2 text-xs">{translateText("Rua OSM: ")}{translateText(document.road_network.links[actor.id]!.name || "sem nome")}{translateText(" · way ")}{translateText(document.road_network.links[actor.id]!.osmWayId)} ·{" "}
              <a className="underline" target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/way/${encodeURIComponent(document.road_network.links[actor.id]!.osmWayId)}`}>{translateText("Ver fonte OSM")}</a>
            </p>}
            <ScenarioEntityForm key={`${draft.id}:${actor.id}:${formVersion}`} source={actor} document={document} isNew={!!newActor}
              onDirty={() => setFormDirty(true)} onDiscard={clearForm} onRoute={calculate} onApply={(value) => {
                if (!/^-?\d+$/.test(value.id)) return setMessage("Use uma identidade inteira de 64 bits.")
                value = { ...value, id: BigInt(value.id).toString() }
                if (BigInt(value.id) < -(2n ** 63n) || BigInt(value.id) >= 2n ** 63n || (newActor && document.actors.some((a) => BigInt(a.id) === BigInt(value.id)))) return setMessage("Escolha uma identidade inteira de 64 bits nova e única.")
                change(newActor ? "Adicionar entidade" : "Editar entidade", { actors: [{ id: value.id, value }] }); setSelection(value.id)
              }} />
            {!newActor && <div className="mt-4 flex gap-2 border-t pt-3">
              <Button size="sm" variant="outline" disabled={formDirty || (document.map_mode === "osm" && ["Node", "Link"].includes(entityKind(actor)))} onClick={() => { change("Remover entidade", { actors: [{ id: actor.id, value: null }] }); setSelection(null) }}>{translateText("Excluir entidade do rascunho")}</Button>
              {entityKind(actor) === "Link" && <Button size="sm" variant="outline" disabled={locked || document.map_mode === "osm"} onClick={() => splitRoad(actor)}>{translateText("Dividir via ao meio")}</Button>}
            </div>}
          </> : line ? <>
            <ScenarioLineForm key={`${draft.id}:${line.lineId}:${formVersion}`} source={line} document={document} onDirty={() => setFormDirty(true)} onDiscard={clearForm} onApply={(value) => void act(() => applyLine(line, value))} />
            {!newLine && <div className="mt-3 flex gap-2 border-t pt-3"><Button size="sm" disabled={locked} onClick={() => void act(() => createDeparture(line))}>{translateText("Criar partida desta linha")}</Button>
              <Button size="sm" variant="outline" disabled={locked} onClick={() => { change("Remover linha", { lines: [{ id: line.lineId, value: null }] }); setSelection(null) }}>{translateText("Excluir linha")}</Button></div>}
          </> : <p className="text-xs text-muted-foreground">{translateText("Selecione uma entidade no mapa ou na lista, ou adicione uma nova.")}</p>}
        </fieldset>
      </div>
      {showDemand && <fieldset disabled={locked} className="flex flex-col gap-3 rounded-sm border p-4 text-xs"><legend className="px-1 font-medium">{translateText("Demanda sintética OD")}</legend>
        <p>{translateText("Gera partidas com rota dirigida e IDs distintos em uma única ação reversível. O intervalo está em ticks do cenário.")}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label>{translateText("Tipo")}<select className={editorInput} value={od.kind} onChange={(event) => setOd({ ...od, kind: event.target.value })}><option value="Car">{translateText("Carros")}</option><option value="Person">{translateText("Pessoas caminhando")}</option><option value="BusPassenger">{translateText("Passageiros de ônibus")}</option><option value="SubwayPassenger">{translateText("Passageiros de metrô")}</option></select></label>
          {["BusPassenger", "SubwayPassenger"].includes(od.kind) ? <label className="sm:col-span-2">{translateText("Linha (embarque na primeira parada, desembarque na última)")}<select className={editorInput} value={od.line} onChange={(event) => setOd({ ...od, line: event.target.value })}><option value="">{translateText("Selecione…")}</option>{document.lines.filter((line) => line.stopType === (od.kind === "BusPassenger" ? "bus" : "subway")).map((line) => <option key={line.lineId} value={line.lineId}>{translateText(line.lineId)}</option>)}</select></label> : <>
            <label>{translateText("Origem")}<EntitySelect document={document} kind="Node" value={od.origin} label={translateText("Origem da demanda")} onChange={(id) => setOd({ ...od, origin: id })} /></label>
            <label>{translateText("Destino")}<EntitySelect document={document} kind="Node" value={od.destination} label={translateText("Destino da demanda")} onChange={(id) => setOd({ ...od, destination: id })} /></label>
          </>}
          {[["count", "Número de partidas"], ["start", "Primeira partida (tick)"], ["interval", "Intervalo (ticks)"]].map(([key, label]) => <label key={key}>{translateText(label)}<input className={editorInput} type="number" min={key === "count" ? 1 : 0} value={od[key as "count" | "start" | "interval"]} onChange={(event) => setOd({ ...od, [key!]: Number(event.target.value) })} /></label>)}
        </div><Button size="sm" className="self-start" onClick={() => void act(generateDemand)}>{translateText("Adicionar partidas ao rascunho")}</Button>
      </fieldset>}
      {validation && <div className={`rounded-sm border p-4 text-xs ${validation.ok ? "border-green-500/40" : "border-destructive/40"}`} role="status">
        <p className="font-medium">{validation.ok ? translateText("Revisão válida para publicação") : translateText("{0} erro(s) para corrigir", { 0: validation.errors.length })}</p>
        <ul className="mt-2 list-disc pl-4">{validation.errors.map((error, i) => <li key={i} className="text-destructive"><button type="button" className="text-left underline" onClick={() => { if (error.entity_id && document.actors.some((a) => a.id === error.entity_id)) select(error.entity_id) }}>{error.entity_id ? translateText("{0}: ", { 0: error.entity_id }) : translateText("")}{translateText(error.message)}</button></li>)}
          {validation.warnings.map((warning, i) => <li key={`warning-${i}`} className="text-muted-foreground">{translateText(warning)}</li>)}</ul>
      </div>}
      <div className="flex flex-wrap items-end gap-2 rounded-sm border p-4 text-xs">
        <label>{translateText("Nome da nova revisão")}<input className={editorInput} placeholder={translateText("bairro-revisao-2")} value={revision} onChange={(event) => setRevision(event.target.value)} /></label>
        <Button size="sm" disabled={locked || !revision.trim()} onClick={() => void act(async () => {
          const current = dirty ? await save() : draft
          const result = await editorRequest<Validation>(`/drafts/${current.id}/validate`, { document: current.document }); setValidation(result)
          if (!result.ok) throw new Error("Corrija os erros indicados antes de publicar.")
          const published = await editorRequest<{ ref: string; draft: Draft }>(`/drafts/${current.id}/publish`, { version: current.version, revision: revision.trim() })
          accept(published.draft, false); localStorage.setItem(cacheKey(current.id), JSON.stringify(published.draft)); setMessage(`Revisão publicada: ${published.ref}`)
        })}>{translateText("Validar e publicar nova revisão")}</Button>
        <span className="text-muted-foreground">{translateText("Erros podem ser salvos no rascunho; a publicação exige uma rede consistente.")}</span>
        {draft.published.map((item) => <span key={`${item.ref}:${item.draft_version}`} className="w-full">{translateText("Publicada: ")}{translateText(item.ref)} · <Link className="underline" href="/simulator">{translateText("Abrir simulador e selecionar revisão")}</Link> · <Link className="underline" href="/simulator/runs">{translateText("Execuções HTC (perfil de carros independentes)")}</Link></span>)}
      </div>
    </>}
  </section>
}
