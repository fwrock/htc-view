"use client"

import { useI18n } from "@/components/i18n-provider"

import { useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { documentStops, entityKind, entityName, type EditorDocument, type Entity, type TransitLine } from "@/lib/scenario-editor"

export const editorInput = "w-full rounded-sm border border-input bg-background px-2 py-1.5 text-xs"
export const entityLabels: Record<string, string> = { Node: "Nós", Link: "Vias", TrafficSignal: "Semáforos", BusStop: "Paradas de ônibus", BusStation: "Terminais de ônibus", SubwayStation: "Estações de metrô", RailLink: "Trilhos", Car: "Carros", Person: "Pessoas", Bus: "Ônibus", Subway: "Trens de metrô", Bicycle: "Bicicletas", Motorcycle: "Motos" }
type Field = [string, string, string, string?]
const nodeFields: Field[] = [["origin", "Origem", "id", "Node"], ["destination", "Destino", "id", "Node"]]
const roadFields: Field[] = [["from", "Nó de origem", "id", "Node"], ["to", "Nó de destino", "id", "Node"], ["length", "Comprimento (m)", "number"], ["lanes", "Faixas / trilhos", "number"], ["speedLimit", "Limite (km/h)", "number"], ["freeSpeed", "Velocidade livre (km/h)", "number"], ["capacity", "Capacidade", "number"], ["simulationMode", "Nível", "mode"]]
const fields: Record<string, Field[]> = {
  Node: [["latitude", "Latitude", "number"], ["longitude", "Longitude", "number"]],
  Link: [...roadFields, ["microTimeStep", "Passo MICRO (s)", "number"], ["microTicksPerGlobalTick", "Passos MICRO por tick", "number"], ["laneConfigurations", "Configuração de faixas", "json"]],
  RailLink: [...roadFields, ["fromStation", "Estação de origem", "id", "SubwayStation"], ["toStation", "Estação de destino", "id", "SubwayStation"], ["subwayLine", "Linha de metrô", "text"], ["railType", "Tipo de trilho", "text"]],
  TrafficSignal: [["cycleDuration", "Ciclo (ticks)", "number"], ["offset", "Defasagem (ticks)", "number"], ["nodes", "Nós controlados", "ids", "Node"], ["phases", "Fases", "phases"]],
  BusStop: [["label", "Nome da parada", "text"], ["nodeId", "Nó da parada", "id", "Node"]],
  BusStation: [["name", "Nome do terminal", "text"], ...nodeFields, ["interval", "Intervalo de saída (ticks)", "number"], ["busStops", "Paradas atendidas", "stops"], ["buses", "Frota despachada (actorId, label, capacity, numberOfPorts, size)", "json"]],
  SubwayStation: [["name", "Nome da estação", "text"], ["nodeId", "Nó da estação", "id", "Node"], ["terminal", "Terminal", "boolean"], ["garage", "Garagem / despacho", "boolean"], ["lines", "Linhas e intervalos", "json"], ["subways", "Trens despachados por linha", "json"], ["linesRoute", "Itinerários de despacho (stationNode, railLinkId)", "json"]],
  Car: [...nodeFields, ["size", "Comprimento (m)", "number"], ["bestRoute", "Rota [via, nó de chegada]", "json"]],
  Person: [["originalPlan", "Plano de atividades e viagens", "json"], ["ownedVehicles", "Veículos próprios", "json"], ["modeChoiceWeights", "Escolha de modo", "json"]],
  Bus: [["label", "Linha", "text"], ...nodeFields, ["capacity", "Capacidade de passageiros", "number"], ["numberOfPorts", "Portas", "number"], ["size", "Comprimento (m)", "number"], ["busStops", "Paradas atendidas", "stops"], ["storedBestRoute", "Rota [via, nó de chegada]", "json"]],
  Subway: [["line", "Linha", "text"], ...nodeFields, ["capacity", "Capacidade", "number"], ["numberOfPorts", "Portas", "number"], ["velocity", "Velocidade (m/s)", "number"], ["stopTime", "Parada (ticks)", "number"], ["subwayStations", "Estações (id → nó)", "json"], ["bestRoute", "Rota [trilho, nó de chegada]", "json"]],
  Bicycle: [...nodeFields, ["size", "Comprimento (m)", "number"], ["bestRoute", "Rota [via, nó de chegada]", "json"]],
  Motorcycle: [...nodeFields, ["size", "Comprimento (m)", "number"], ["bestRoute", "Rota [via, nó de chegada]", "json"]],
}

function JsonField({ value, onChange, onError, objectOnly = false }: { value: unknown; onChange: (value: unknown) => void; onError: (invalid: boolean) => void; objectOnly?: boolean }) {
  const { t: translateText } = useI18n()

  const [raw, setRaw] = useState<string | null>(null)
  const [error, setError] = useState("")
  return <><textarea className={`${editorInput} min-h-28 font-mono`} spellCheck={false} value={raw ?? JSON.stringify(value ?? null, null, 2)} onBlur={() => { if (!error) setRaw(null) }} onChange={(event) => {
    setRaw(event.target.value)
    try { const parsed = JSON.parse(event.target.value); if (objectOnly && (!parsed || typeof parsed !== "object" || Array.isArray(parsed))) throw new Error("Expected object"); onChange(parsed); setError(""); onError(false) }
    catch { setError("JSON incompleto ou inválido; corrija antes de aplicar."); onError(true) }
  }} />{error && <span role="alert" className="text-destructive">{translateText(error)}</span>}</>
}

export function EntitySelect({ document, kind, value, onChange, label }: { document: EditorDocument; kind: string; value: string; onChange: (id: string) => void; label: string }) {
  const { t: translateText } = useI18n()

  const actors = document.actors.filter((actor) => entityKind(actor) === kind)
  return <select aria-label={translateText(label)} className={editorInput} value={value} onChange={(event) => onChange(event.target.value)}>
    <option value="">{translateText("Selecione…")}</option>
    {value && !actors.some((actor) => actor.id === value) && <option value={value}>{translateText(value)}{translateText(" · referência ausente")}</option>}
    {actors.map((actor) => <option key={actor.id} value={actor.id}>{entityName(actor)}{entityName(actor) !== actor.id ? translateText(" · {0}", { 0: actor.id }) : translateText("")}</option>)}
  </select>
}

export function ScenarioEntityForm({ source, document, isNew, onApply, onDiscard, onRoute, onDirty }: {
  source: Entity; document: EditorDocument; isNew?: boolean
  onApply: (entity: Entity) => void; onDiscard: () => void
  onRoute: (entity: Entity) => Promise<Entity>; onDirty: () => void
}) {
  const { t: translateText } = useI18n()

  const [actor, setActor] = useState(source)
  const [invalid, setInvalid] = useState<Record<string, boolean>>({})
  const [error, setError] = useState("")
  const [routing, setRouting] = useState(false)
  const cls = entityKind(actor), s = actor.data.content
  const set = (field: string, value: unknown) => { setActor((a) => ({ ...a, data: { ...a.data, content: { ...a.data.content, [field]: value } } })); onDirty() }
  const jsonError = (field: string, bad: boolean) => { setInvalid((values) => ({ ...values, [field]: bad })); onDirty() }
  const list = [...(cls === "BusStop" ? [] : [["startTick", "Tick inicial / partida", "number"] as Field]), ...(fields[cls] ?? [])]
  return <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); onApply(actor) }}>
    <h3 className="font-medium">{translateText(entityLabels[cls] ?? cls)} · {actor.id}</h3>
    {isNew && <label className="text-xs">{translateText("Identidade inteira (64 bits)")}<input className={editorInput} value={actor.id} inputMode="numeric" onChange={(event) => { setActor({ ...actor, id: event.target.value }); onDirty() }} /></label>}
    <div className="grid gap-3 sm:grid-cols-2">
      {list.map(([field, label, type, ref]) => <div key={field} className={`flex flex-col gap-1 text-xs ${["json", "phases", "stops"].includes(type) ? "sm:col-span-2" : ""}`}>
        <label htmlFor={`entity-${field}`}>{translateText(label)}</label>
        {type === "id" ? <EntitySelect document={document} kind={ref!} value={String(s[field] ?? "")} onChange={(id) => set(field, id)} label={translateText(label)} />
          : type === "mode" ? <select id={`entity-${field}`} className={editorInput} value={String(s[field] ?? "MESO")} onChange={(event) => set(field, event.target.value)}><option>{translateText("MESO")}</option><option>{translateText("MICRO")}</option></select>
          : type === "boolean" ? <input id={`entity-${field}`} type="checkbox" checked={s[field] === true} onChange={(event) => set(field, event.target.checked)} />
          : type === "json" ? <JsonField value={s[field]} onChange={(value) => set(field, value)} onError={(bad) => jsonError(field, bad)} />
          : type === "ids" ? <select id={`entity-${field}`} multiple className={editorInput} value={Array.isArray(s[field]) ? s[field].map(String) : []}
            onChange={(event) => set(field, [...event.target.selectedOptions].map((option) => option.value))}>
            {document.actors.filter((a) => entityKind(a) === ref).map((a) => <option key={a.id} value={a.id}>{entityName(a)}</option>)}</select>
          : type === "phases" ? <div className="flex flex-col gap-2">
            {((Array.isArray(s.phases) ? s.phases : []) as Record<string, unknown>[]).map((phase, i, phases) => <div className="grid grid-cols-[2fr_1fr_1fr_auto] gap-1" key={i}>
              <EntitySelect document={document} kind="Link" label={translateText("Via da fase {0}", { 0: i + 1 })} value={String(phase.origin ?? "")} onChange={(id) => set("phases", phases.map((p, j) => j === i ? { ...p, origin: id } : p))} />
              {["greenStart", "greenDuration"].map((name) => <input aria-label={translateText("{0} fase {1}", { 0: name, 1: i + 1 })} key={name} className={editorInput} type="number" value={Number(phase[name] ?? 0)} onChange={(event) => set("phases", phases.map((p, j) => j === i ? { ...p, [name]: Number(event.target.value) } : p))} />)}
              <button type="button" aria-label={translateText("Remover fase {0}", { 0: i + 1 })} onClick={() => set("phases", phases.filter((_, j) => j !== i))}>{translateText("×")}</button>
            </div>)}
            <span className="text-muted-foreground">{translateText("Via de aproximação · início verde · duração verde (ticks)")}</span>
            <button type="button" className="self-start underline" onClick={() => set("phases", [...(Array.isArray(s.phases) ? s.phases : []), { origin: "0", greenStart: 0, greenDuration: 30, state: "Green" }])}>{translateText("+ fase")}</button>
          </div>
          : type === "stops" ? <div className="flex flex-col gap-2">
            {Object.entries((s.busStops ?? {}) as Record<string, string>).map(([stop, node]) => <div key={stop} className="flex gap-2"><span>{entityName(document.actors.find((a) => a.id === stop) ?? { id: stop, data: { content: {} } } as Entity)}{translateText(" · nó ")}{translateText(node)}</span>
              <button type="button" aria-label={translateText("Remover parada {0}", { 0: stop })} onClick={() => set("busStops", Object.fromEntries(Object.entries(s.busStops as object).filter(([id]) => id !== stop)))}>{translateText("×")}</button></div>)}
            <EntitySelect document={document} kind="BusStop" value="" label={translateText("Adicionar parada")} onChange={(id) => { const stop = document.actors.find((a) => a.id === id); if (stop) set("busStops", { ...(s.busStops as object), [id]: String(stop.data.content.nodeId) }) }} />
            {cls === "BusStation" && <p className="text-muted-foreground">{translateText("O engine percorre os terminais por ID de parada em ordem numérica e exige trajeto de volta. Linhas com outra ordem podem usar partidas de ônibus com rota fixa.")}</p>}
          </div>
          : <input id={`entity-${field}`} className={editorInput} type={type === "number" ? "number" : "text"} step="any" value={s[field] == null ? "" : String(s[field])}
            onChange={(event) => set(field, type === "number" ? event.target.value === "" ? null : Number(event.target.value) : event.target.value)} />}
      </div>)}
    </div>
    {["Car", "Bus", "Subway", "Bicycle", "Motorcycle"].includes(cls) && <Button type="button" size="sm" variant="outline" disabled={routing} onClick={async () => {
      setRouting(true); setError("")
      try { setActor(await onRoute(actor)); onDirty() } catch (failure) { setError((failure as Error).message) } finally { setRouting(false) }
    }}>{routing ? translateText("Calculando…") : ["Bus", "Subway"].includes(cls) ? translateText("Calcular rota de ida e retorno") : translateText("Calcular rota entre origem e destino")}</Button>}
    <details className="text-xs"><summary className="cursor-pointer">{translateText("Conteúdo avançado da entidade (JSON)")}</summary>
      <JsonField value={actor.data.content} objectOnly onError={(bad) => jsonError("advanced", bad)} onChange={(value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) { setInvalid((values) => ({ ...values, advanced: true })); return }
        setActor((a) => ({ ...a, data: { ...a.data, content: value as Record<string, unknown> } })); onDirty()
      }} />
    </details>
    <details className="text-xs"><summary className="cursor-pointer">{translateText("Dependências e propriedade (JSON avançado)")}</summary>
      <p className="my-2 text-muted-foreground">{translateText("Referências por ID: owner liga um veículo à pessoa; a validação verifica a classe de destino. Referências estruturais de nós são derivadas dos campos acima.")}</p>
      <JsonField value={actor.dependencies ?? actor.relationships ?? {}} objectOnly onError={(bad) => jsonError("dependencies", bad)} onChange={(value) => {
        setActor((a) => ({ ...a, dependencies: value as Entity["dependencies"] })); onDirty()
      }} />
    </details>
    {error && <p role="alert" className="text-xs text-destructive">{translateText(error)}</p>}
    <p className="text-[11px] text-muted-foreground">{translateText("Aplique os campos ao rascunho antes de selecionar outra entidade. A validação confere referências e rotas antes da publicação.")}</p>
    <div className="flex gap-2"><Button size="sm" disabled={Object.values(invalid).some(Boolean)}>{translateText("Aplicar ao rascunho")}</Button><Button type="button" size="sm" variant="ghost" onClick={onDiscard}>{translateText("Descartar campos")}</Button></div>
  </form>
}

export function ScenarioLineForm({ source, document, onApply, onDiscard, onDirty }: {
  source: TransitLine; document: EditorDocument; onApply: (line: TransitLine) => void; onDiscard: () => void; onDirty: () => void
}) {
  const { t: translateText } = useI18n()

  const [line, setLine] = useState(source)
  const stops = documentStops(document).filter((stop) => stop.stopType === line.stopType)
  const update = (patch: Partial<TransitLine>) => { setLine((value) => ({ ...value, ...patch })); onDirty() }
  return <form className="flex flex-col gap-3 text-xs" onSubmit={(event) => { event.preventDefault(); onApply(line) }}>
    <h3 className="font-medium">{translateText("Linha de transporte")}</h3>
    <label>{translateText("Identificador / nome")}<input className={editorInput} value={line.lineId} onChange={(event) => update({ lineId: event.target.value })} /></label>
    <label>{translateText("Modo")}<select className={editorInput} value={line.stopType} onChange={(event) => update({ stopType: event.target.value as TransitLine["stopType"], stops: [] })}><option value="bus">{translateText("Ônibus")}</option><option value="subway">{translateText("Metrô")}</option></select></label>
    <label>{translateText("Intervalo (s)")}<input className={editorInput} type="number" min={1} value={line.headwaySeconds} onChange={(event) => update({ headwaySeconds: Number(event.target.value) })} /></label>
    <p>{translateText("Ordem das paradas · tempo desde a anterior (s)")}</p>
    {line.stops.map((entry, index) => <div key={index} className="flex gap-1">
      <select className={editorInput} aria-label={translateText("Parada {0}", { 0: index + 1 })} value={entry.stopId} onChange={(event) => update({ stops: line.stops.map((s, i) => i === index ? { ...s, stopId: event.target.value } : s) })}>
        <option value="">{translateText("Selecione…")}</option>{stops.map((stop) => <option key={stop.id} value={stop.id}>{entityName(document.actors.find((a) => a.id === stop.actorId)!)} · {translateText(stop.actorId)}</option>)}</select>
      <input className={`${editorInput} max-w-24`} aria-label={translateText("Tempo até parada {0}", { 0: index + 1 })} type="number" min={0} value={entry.travelTimeFromPrevSeconds} onChange={(event) => update({ stops: line.stops.map((s, i) => i === index ? { ...s, travelTimeFromPrevSeconds: Number(event.target.value) } : s) })} />
      <button type="button" aria-label={translateText("Subir parada {0}", { 0: index + 1 })} disabled={index === 0} onClick={() => { const next = [...line.stops]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; update({ stops: next }) }}>↑</button>
      <button type="button" aria-label={translateText("Remover parada {0}", { 0: index + 1 })} onClick={() => update({ stops: line.stops.filter((_, i) => i !== index) })}>{translateText("×")}</button>
    </div>)}
    <button type="button" className="self-start underline" onClick={() => update({ stops: [...line.stops, { stopId: stops[0]?.id ?? "", travelTimeFromPrevSeconds: line.stops.length ? 60 : 0 }] })}>{translateText("+ parada")}</button>
    <p className="text-muted-foreground">{translateText("Ao aplicar, o itinerário atualiza as rotas e paradas dos veículos desta linha, os intervalos dos terminais e os despachos de metrô. Horários explícitos de partidas são preservados. “Criar partida desta linha” calcula ida e retorno; o ponto inicial é atendido nos ciclos seguintes. Terminais de ônibus seguem a ordem de IDs exigida pelo engine.")}</p>
    <div className="flex gap-2"><Button size="sm">{translateText("Aplicar linha")}</Button><Button type="button" size="sm" variant="ghost" onClick={onDiscard}>{translateText("Descartar campos")}</Button></div>
  </form>
}
