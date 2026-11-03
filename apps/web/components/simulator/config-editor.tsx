"use client"

import { useI18n } from "@/components/i18n-provider"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, RotateCcw, Save, Upload, X } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import {
  getEngineConfig,
  getScenarioConfig,
  saveScenarioConfig,
  type ScenarioConfig,
  type ScenarioConfigDoc,
} from "@/lib/simedape-api"

const TIME_MANAGERS = [
  { id: "discrete-event", label: "discrete-event: conservador (padrão)" },
  { id: "time-stepped", label: "time-stepped: passo fixo" },
  { id: "time-warp", label: "time-warp: otimista" },
]
const MODES = ["car", "bicycle", "motorcycle", "bus", "subway", "walk"]
const field =
  "h-8 rounded-sm border border-input bg-background px-2 text-xs focus:border-ring focus:ring-1 focus:ring-ring/30 focus:outline-none"

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

/** Instant feedback only; the API validates again and is the authority. */
function problemsOf(c: ScenarioConfig): string[] {
  const out: string[] = []
  if (typeof c.name !== "string" || !c.name.trim()) out.push("name é obrigatório")
  for (const k of ["startTick", "duration", "timeStep"])
    if (!isNum(c[k])) out.push(`${k} é obrigatório (número)`)
  if (isNum(c.duration) && c.duration <= 0) out.push("duration deve ser positivo")
  if (isNum(c.timeStep) && c.timeStep <= 0) out.push("timeStep deve ser positivo")
  if (isNum(c.endTick) && isNum(c.startTick) && c.endTick < c.startTick)
    out.push("endTick não pode ser anterior a startTick")
  if (typeof c.startRealTime !== "string" || !c.startRealTime) out.push("startRealTime é obrigatório")
  if (typeof c.timeUnit !== "string" || !c.timeUnit) out.push("timeUnit é obrigatório")
  for (const [name, keys] of [["loadFilter", ["includeClasses", "excludeClasses", "transforms"]], ["partial", ["filterableClasses"]]] as const) {
    const value = c[name]
    if (value == null) continue
    if (typeof value !== "object" || Array.isArray(value)) {
      out.push(`${name} deve ser um objeto`)
      continue
    }
    const fields = value as Record<string, unknown>
    for (const key of keys) {
      const items = fields[key] ?? []
      if (!Array.isArray(items) || items.some((item) => typeof item !== "string" || !item.trim())) out.push(`${name}.${key} deve ser uma lista de classes`)
    }
    if (name === "partial" && (typeof fields.selectionFile !== "string" || !fields.selectionFile.trim() || !Array.isArray(fields.filterableClasses) || !fields.filterableClasses.length)) out.push("Seleção parcial exige arquivo de seleção e classes filtráveis")
  }
  const cache = c.calculationCache
  if (cache != null) {
    if (typeof cache !== "object" || Array.isArray(cache)) out.push("calculationCache must be an object")
    else {
      const v = cache as Record<string, unknown>
      if (v.directory != null && (typeof v.directory !== "string" || !v.directory.trim())) out.push("calculationCache.directory must be a non-empty string")
      const entries = v.entries ?? []
      if (!Array.isArray(entries) || entries.some((id) => typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(id)) || new Set(entries).size !== entries.length) out.push("calculationCache.entries must be unique calculation identifiers")
      if (v.refresh != null && typeof v.refresh !== "boolean") out.push("calculationCache.refresh must be true or false")
    }
  }
  return out
}

function Field({
  label,
  hint,
  children,
  wide,
}: {
  label: string
  hint?: string
  children: React.ReactNode
  wide?: boolean
}) {
  const { t: translateText } = useI18n()

  return (
    <label className={cn("flex flex-col gap-1 text-xs", wide && "sm:col-span-2")}>
      <span className="font-medium">{translateText(label)}</span>
      {children}
      {hint && <span className="text-[11px] text-muted-foreground">{translateText(hint)}</span>}
    </label>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  const { t: translateText } = useI18n()

  return (
    <fieldset className="rounded-sm border border-border p-3">
      <legend className="px-1 text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
        {translateText(title)}
      </legend>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  )
}

type Source = "scenario" | "engine"

export function ConfigEditor({
  scenarioRef,
  engineConfigJson,
  onApplyToEngine,
  onClearEngine,
}: {
  /** `<location>:<scenario>` selected in Execução, or "" when none. */
  scenarioRef: string
  /** The configuration currently overriding the engine (JSON text). */
  engineConfigJson: string
  onApplyToEngine: (config: ScenarioConfig) => Promise<void>
  onClearEngine: () => Promise<void>
}) {
  const { t: translateText } = useI18n()

  const [source, setSource] = useState<Source>(scenarioRef ? "scenario" : "engine")
  const [doc, setDoc] = useState<ScenarioConfigDoc | null>(null)
  const [draft, setDraft] = useState<ScenarioConfig>({})
  const [rawText, setRawText] = useState("{}")
  const [rawError, setRawError] = useState<string | null>(null)
  const [view, setView] = useState<"form" | "json">("form")
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [confirmSave, setConfirmSave] = useState(false)

  const engineConfig = useMemo<ScenarioConfig>(() => {
    try {
      const v = JSON.parse(engineConfigJson)
      return v && typeof v === "object" ? (v as ScenarioConfig) : {}
    } catch {
      return {}
    }
  }, [engineConfigJson])

  // Follows the scenario chosen in Execução.
  useEffect(() => {
    setSource(scenarioRef ? "scenario" : "engine")
  }, [scenarioRef])

  const load = useCallback(async () => {
    setMessage(null)
    setConfirmSave(false)
    setRawError(null)
    if (source === "scenario" && scenarioRef) {
      try {
        const d = await getScenarioConfig(scenarioRef)
        setDoc(d)
        setDraft(d.config)
        setRawText(JSON.stringify(d.config, null, 2))
        setLoadError(null)
      } catch (e) {
        setDoc(null)
        setDraft({})
        setLoadError((e as Error).message)
      }
    } else {
      setDoc(null)
      setDraft(engineConfig)
      setRawText(JSON.stringify(engineConfig, null, 2))
      setLoadError(null)
    }
  }, [source, scenarioRef, engineConfig])
  useEffect(() => {
    void load()
  }, [load])

  const original = source === "scenario" ? doc?.config : engineConfig
  const dirty = JSON.stringify(draft) !== JSON.stringify(original ?? {})
  const problems = useMemo(() => problemsOf(draft), [draft])

  function update(patch: Record<string, unknown>) {
    setDraft((d) => {
      const next = { ...d }
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0 && !(k in d))) delete next[k]
        else next[k] = v
      }
      setRawText(JSON.stringify(next, null, 2))
      return next
    })
    setMessage(null)
    setConfirmSave(false)
  }
  const text = (k: string) => (typeof draft[k] === "string" ? (draft[k] as string) : "")
  const num = (k: string) => (isNum(draft[k]) ? String(draft[k]) : "")
  const setNum = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    update({ [k]: e.target.value === "" ? undefined : Number(e.target.value) })
  const lines = (k: string) => (Array.isArray(draft[k]) ? (draft[k] as string[]).join("\n") : "")
  const setLines = (k: string) => (e: React.ChangeEvent<HTMLTextAreaElement>) =>
    update({ [k]: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })
  const modes = Array.isArray(draft.modeChoiceIncludedModes) ? (draft.modeChoiceIncludedModes as string[]) : []
  const block = (name: string): Record<string, unknown> => {
    const value = draft[name]
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
  }
  const blockLines = (name: string, key: string) => {
    const value = block(name)[key]
    return Array.isArray(value) ? value.join("\n") : ""
  }
  const setBlockLines = (name: string, key: string) => (e: React.ChangeEvent<HTMLTextAreaElement>) =>
    update({ [name]: { ...block(name), [key]: e.target.value.split(/[\n,]/).map((x) => x.trim()).filter(Boolean) } })

  function onRaw(value: string) {
    setRawText(value)
    try {
      const v = JSON.parse(value)
      if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("precisa ser um objeto JSON")
      setDraft(v as ScenarioConfig)
      setRawError(null)
    } catch (e) {
      setRawError((e as Error).message)
    }
  }

  async function run(name: string, fn: () => Promise<string>) {
    setBusy(name)
    setMessage(null)
    try {
      setMessage({ ok: true, text: await fn() })
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(null)
      setConfirmSave(false)
    }
  }

  const apply = () =>
    run("apply", async () => {
      // Scenario files may hold relative/host paths; the engine needs the ones it can open.
      const cfg = source === "scenario" ? (await getEngineConfig(scenarioRef, draft)).config : draft
      await onApplyToEngine(cfg)
      return "Configuração aplicada ao engine (override ativo até ser limpo)."
    })
  const save = () =>
    run("save", async () => {
      if (!doc) throw new Error("nada carregado")
      const r = await saveScenarioConfig(scenarioRef, draft, doc.sha256)
      await load()
      return `Gravado em ${r.path}. Backup: ${r.backup}`
    })

  const sources = Array.isArray(draft.actorsDataSources)
    ? (draft.actorsDataSources as {
        id?: string
        classType?: string
        dataSource?: { sourceType?: string; info?: { path?: string } }
      }[])
    : []

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label={translateText("Origem da configuração")} className="inline-flex overflow-hidden rounded-sm border border-border text-xs">
          <button
            type="button"
            disabled={!scenarioRef}
            onClick={() => setSource("scenario")}
            className={cn("px-3 py-1.5", source === "scenario" ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground", !scenarioRef && "cursor-not-allowed opacity-50")}
          >{translateText("Cenário selecionado")}</button>
          <button
            type="button"
            onClick={() => setSource("engine")}
            className={cn("border-l border-border px-3 py-1.5", source === "engine" ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground")}
          >{translateText("Override atual do engine")}</button>
        </div>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
          {source === "scenario" ? translateText((doc?.path ?? scenarioRef)) : translateText("configuração enviada diretamente ao engine")}
        </span>
        <div role="group" aria-label={translateText("Modo de edição")} className="inline-flex overflow-hidden rounded-sm border border-border text-xs">
          {(["form", "json"] as const).map((v, i) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              disabled={v === "form" && !!rawError}
              className={cn(i > 0 && "border-l border-border", "px-3 py-1.5", view === v ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground")}
            >
              {v === "form" ? translateText("Formulário") : translateText("JSON")}
            </button>
          ))}
        </div>
      </div>

      {!scenarioRef && source === "scenario" ? null : null}
      {!scenarioRef && (
        <p className="rounded-sm border border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">{translateText("Escolha um cenário em ")}<b>{translateText("Execução")}</b>{translateText(" para abrir o ")}<code className="font-mono">simulation.json</code>{translateText(" dele aqui. Enquanto isso, você edita o override atual do engine.")}</p>
      )}
      {loadError && <p className="text-xs text-destructive" role="alert">{translateText(loadError)}</p>}

      {view === "form" ? (
        <div className="flex flex-col gap-3">
          <Group title={translateText("Identificação")}>
            <Field label={translateText("Nome *")}><input className={field} value={text("name")} onChange={(e) => update({ name: e.target.value })} /></Field>
            <Field label={translateText("Id")}><input className={field} value={text("id")} onChange={(e) => update({ id: e.target.value })} /></Field>
            <Field label={translateText("Descrição")} wide><input className={field} value={text("description")} onChange={(e) => update({ description: e.target.value })} /></Field>
          </Group>

          <Group title={translateText("Tempo")}>
            <Field label={translateText("Tick inicial *")} hint={translateText("Os fluxos nativos exigem 0.")}><input className={field} type="number" value={num("startTick")} onChange={setNum("startTick")} /></Field>
            <Field label={translateText("Tick final")} hint={translateText("Opcional; fim da simulação.")}><input className={field} type="number" value={num("endTick")} onChange={setNum("endTick")} /></Field>
            <Field label={translateText("Duração *")} hint={translateText("Em ticks.")}><input className={field} type="number" value={num("duration")} onChange={setNum("duration")} /></Field>
            <Field label={translateText("Passo (timeStep) *")}><input className={field} type="number" step="any" value={num("timeStep")} onChange={setNum("timeStep")} /></Field>
            <Field label={translateText("Duração do tick")} hint={translateText("Segundos simulados por tick (opcional).")}><input className={field} type="number" step="any" value={num("tickDuration")} onChange={setNum("tickDuration")} /></Field>
            <Field label={translateText("Unidade de tempo *")}>
              <input className={field} list="time-units" value={text("timeUnit")} onChange={(e) => update({ timeUnit: e.target.value })} />
              <datalist id="time-units"><option value="seconds" /><option value="minutes" /><option value="hours" /></datalist>
            </Field>
            <Field label={translateText("Início em tempo real *")} hint={translateText("Ex.: 2025-01-01T00:00:00.000")}><input className={field} value={text("startRealTime")} onChange={(e) => update({ startRealTime: e.target.value })} /></Field>
            <Field label={translateText("Semente aleatória")} hint={translateText("Inteiro; mesma semente, mesmo resultado.")}><input className={field} type="number" step={1} value={num("randomSeed")} onChange={setNum("randomSeed")} /></Field>
          </Group>

          <Group title={translateText("Sincronização")}>
            <Field label={translateText("Gerenciador de tempo")} hint={translateText("Padrão: discrete-event (conservador). time-warp é otimista e experimental.")}>
              <select className={field} value={text("timeManagerType") || "discrete-event"} onChange={(e) => update({ timeManagerType: e.target.value === "discrete-event" ? undefined : e.target.value })}>
                {TIME_MANAGERS.map((t) => <option key={t.id} value={t.id}>{translateText(t.label)}</option>)}
              </select>
            </Field>
            <label className="flex items-center gap-2 self-end pb-1 text-xs">
              <input type="checkbox" checked={draft.extendSimulationIfPendingEventsAfterEnd === true} onChange={(e) => update({ extendSimulationIfPendingEventsAfterEnd: e.target.checked || undefined })} />{translateText("Estender se houver eventos pendentes após o fim")}</label>
          </Group>

          <Group title={translateText("Escolha de modo de transporte")}>
            <label className="flex items-center gap-2 text-xs sm:col-span-2">
              <input type="checkbox" checked={draft.enableDynamicModeChoice === true} onChange={(e) => update({ enableDynamicModeChoice: e.target.checked || undefined })} />{translateText("Escolha dinâmica de modo")}</label>
            <div className="sm:col-span-2">
              <p className="mb-1 text-xs font-medium">{translateText("Modos permitidos")}</p>
              <div className="flex flex-wrap gap-3 text-xs">
                {MODES.map((m) => (
                  <label key={m} className="flex items-center gap-1.5">
                    <input type="checkbox" checked={modes.includes(m)} onChange={(e) => update({ modeChoiceIncludedModes: e.target.checked ? [...modes, m] : modes.filter((x) => x !== m) })} />
                    {translateText(m)}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{translateText("Nenhum marcado = cada pessoa usa o seu padrão.")}</p>
            </div>
          </Group>

          <Group title={translateText("Arquivos do mapa")}>
            <Field label={translateText("Mapa da cidade")} hint={translateText("Relativo ao cenário (data/city_map.json) ou absoluto.")} wide><input className={cn(field, "font-mono")} value={text("cityMapFile")} onChange={(e) => update({ cityMapFile: e.target.value })} /></Field>
            <Field label={translateText("Mapa de transporte público")}><input className={cn(field, "font-mono")} value={text("transitMapFile")} onChange={(e) => update({ transitMapFile: e.target.value })} /></Field>
            <Field label={translateText("Rotas de transporte público")}><input className={cn(field, "font-mono")} value={text("transitRoutesFile")} onChange={(e) => update({ transitRoutesFile: e.target.value })} /></Field>
          </Group>

          <Group title={translateText("Filtro de classes na carga")}>
            <label className="flex items-center gap-2 text-xs sm:col-span-2">
              <input type="checkbox" checked={draft.loadFilter != null} onChange={(e) => update({ loadFilter: e.target.checked ? { includeClasses: [], excludeClasses: [], transforms: [] } : undefined })} />
              {translateText("Definir filtro neste simulation.json")}
            </label>
            <p className="text-[11px] text-muted-foreground sm:col-span-2">{translateText("Sem este bloco, usa o filtro do application.conf. Um bloco vazio carrega todas as classes. Exclusões têm prioridade; dependências para classes excluídas precisam ser corrigidas por uma transformação do modelo.")}</p>
            {draft.loadFilter != null && <>
              <Field label={translateText("Classes incluídas")} hint={translateText("Uma por linha. Vazio = todas. Ex.: hybrid.actor.Person")}><textarea rows={3} className={cn(field, "h-auto py-1.5 font-mono")} value={blockLines("loadFilter", "includeClasses")} onChange={setBlockLines("loadFilter", "includeClasses")} /></Field>
              <Field label={translateText("Classes excluídas")} hint={translateText("Uma por linha. Ex.: hybrid.actor.Bicycle")}><textarea rows={3} className={cn(field, "h-auto py-1.5 font-mono")} value={blockLines("loadFilter", "excludeClasses")} onChange={setBlockLines("loadFilter", "excludeClasses")} /></Field>
              <Field label={translateText("Transformações de carga")} hint={translateText("Classes ActorLoadTransform instaladas no engine, uma por linha.")} wide><textarea rows={2} className={cn(field, "h-auto py-1.5 font-mono")} value={blockLines("loadFilter", "transforms")} onChange={setBlockLines("loadFilter", "transforms")} /></Field>
            </>}
          </Group>

          <Group title={translateText("Simulação parcial")}>
            <label className="flex items-center gap-2 text-xs sm:col-span-2">
              <input type="checkbox" checked={draft.partial != null} onChange={(e) => update({ partial: e.target.checked ? { selectionFile: "", filterableClasses: ["Person", "Car", "Bicycle", "Motorcycle"] } : undefined })} />
              {translateText("Carregar uma seleção de atores")}
            </label>
            {draft.partial != null && <>
              <Field label={translateText("Arquivo de seleção")} hint={translateText("selection.json: caminho relativo ao cenário ou absoluto no engine.")} wide><input className={cn(field, "font-mono")} value={String(block("partial").selectionFile ?? "")} onChange={(e) => update({ partial: { ...block("partial"), selectionFile: e.target.value } })} /></Field>
              <Field label={translateText("Classes filtráveis")} hint={translateText("Uma por linha. As outras classes são mantidas completas.")}><textarea rows={3} className={cn(field, "h-auto py-1.5 font-mono")} value={blockLines("partial", "filterableClasses")} onChange={setBlockLines("partial", "filterableClasses")} /></Field>
              <Field label={translateText("Arquivo do relatório (opcional)")}><input className={cn(field, "font-mono")} value={String(block("partial").reportFile ?? "")} onChange={(e) => update({ partial: { ...block("partial"), reportFile: e.target.value || undefined } })} /></Field>
            </>}
          </Group>

          <Group title={translateText("Cache de cálculos")}>
            <label className="flex items-center gap-2 text-xs sm:col-span-2">
              <input type="checkbox" checked={draft.calculationCache != null} onChange={(e) => update({ calculationCache: e.target.checked ? { directory: ".htc-cache", entries: ["routing.alt.vehicle", "routing.alt.pedestrian"], refresh: false } : undefined })} />
              {translateText("Reutilizar cálculos entre simulações")}
            </label>
            {draft.calculationCache != null && <>
              <Field label={translateText("Diretório do cache")} hint={translateText("Relativo ao cenário ou absoluto no engine. Arquivos binários gzip.")} wide><input className={cn(field, "font-mono")} value={String(block("calculationCache").directory ?? ".htc-cache")} onChange={(e) => update({ calculationCache: { ...block("calculationCache"), directory: e.target.value } })} /></Field>
              <Field label={translateText("Cálculos persistidos")} hint={translateText("Um por linha: routing.alt.vehicle, routing.alt.pedestrian. Remova uma linha para desativar o cache desse cálculo.")} wide><textarea rows={3} className={cn(field, "h-auto py-1.5 font-mono")} value={blockLines("calculationCache", "entries")} onChange={setBlockLines("calculationCache", "entries")} /></Field>
              <label className="flex items-center gap-2 text-xs sm:col-span-2"><input type="checkbox" checked={block("calculationCache").refresh === true} onChange={(e) => update({ calculationCache: { ...block("calculationCache"), refresh: e.target.checked } })} />{translateText("Recalcular e substituir caches no próximo início (desmarque depois)")}</label>
            </>}
          </Group>

          <Group title={translateText("Listas avançadas (uma por linha)")}>
            <Field label={translateText("Registro pós-carga")} hint={translateText("Ex.: hybrid.actor.BusStop")}><textarea rows={3} className={cn(field, "h-auto py-1.5 font-mono")} value={lines("postLoadRegistrationClasses")} onChange={setLines("postLoadRegistrationClasses")} /></Field>
            <Field label={translateText("Atores dinâmicos")} hint={translateText("Ex.: hybrid.actor.Bus")}><textarea rows={3} className={cn(field, "h-auto py-1.5 font-mono")} value={lines("dynamicActorTypes")} onChange={setLines("dynamicActorTypes")} /></Field>
            <Field label={translateText("Aquecimento (warm-up)")} hint={translateText("Pacote.Objeto#método")} wide><textarea rows={2} className={cn(field, "h-auto py-1.5 font-mono")} value={lines("warmupTargets")} onChange={setLines("warmupTargets")} /></Field>
          </Group>

          <Group title={translateText("Fontes de dados dos atores (somente leitura; edite no JSON)")}>
            <div className="sm:col-span-2">
              {sources.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">{translateText("Nenhuma fonte declarada.")}</p>
              ) : (
                <table className="w-full text-[11px]">
                  <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-3">{translateText("Id")}</th><th className="pr-3">{translateText("Ator")}</th><th className="pr-3">{translateText("Tipo")}</th><th>{translateText("Caminho")}</th></tr></thead>
                  <tbody>
                    {sources.map((x, i) => (
                      <tr key={x.id ?? i} className="border-t border-border">
                        <td className="py-1 pr-3 font-medium">{translateText(x.id)}</td>
                        <td className="pr-3">{translateText(x.classType?.split(".").pop())}</td>
                        <td className="pr-3">{translateText(x.dataSource?.sourceType)}</td>
                        <td className="truncate font-mono text-muted-foreground">{translateText(x.dataSource?.info?.path)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {draft.modelPlugins !== undefined && <p className="mt-2 text-[11px] text-muted-foreground">{translateText("modelPlugins presente: edite no modo JSON.")}</p>}
            </div>
          </Group>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <textarea
            aria-label={translateText("simulation.json")}
            value={rawText}
            onChange={(e) => onRaw(e.target.value)}
            rows={22}
            spellCheck={false}
            className="w-full resize-y rounded-sm border border-input bg-muted/30 p-3 font-mono text-[11px] leading-relaxed focus:border-ring focus:ring-1 focus:ring-ring/30 focus:outline-none"
          />
          {rawError ? <p className="text-[11px] text-destructive">{translateText("JSON inválido: ")}{translateText(rawError)}</p> : <p className="text-[11px] text-muted-foreground">{translateText("As alterações aqui e no formulário são a mesma configuração.")}</p>}
        </div>
      )}

      {(problems.length > 0 || (doc && doc.problems.length > 0 && !dirty)) && (
        <ul className="list-disc space-y-0.5 rounded-sm border border-yellow-500/30 bg-yellow-500/10 py-2 pl-7 pr-3 text-[11px] text-yellow-700 dark:text-yellow-400">
          {(problems.length ? problems : doc?.problems ?? []).map((p) => <li key={p}>{translateText(p)}</li>)}
        </ul>
      )}
      {message && (
        <p role="status" className={cn("text-xs", message.ok ? "text-green-600 dark:text-green-400" : "text-destructive")}>{translateText(message.text)}</p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button size="sm" onClick={apply} disabled={busy !== null || problems.length > 0 || !!rawError || (source === "scenario" && !doc)}>
          {busy === "apply" ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
          {source === "scenario" ? translateText("Aplicar ao engine") : translateText("Enviar ao engine")}
        </Button>
        {source === "scenario" && doc?.writable && (
          confirmSave ? (
            <>
              <span className="text-[11px] text-muted-foreground">{translateText("Grava o simulation.json do cenário (cria backup .bak).")}</span>
              <Button size="sm" variant="destructive" onClick={save} disabled={busy !== null}>{translateText("Confirmar gravação")}</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmSave(false)}>{translateText("Cancelar")}</Button>
            </>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setConfirmSave(true)} disabled={busy !== null || !dirty || problems.length > 0 || !!rawError}>
              <Save className="size-3.5" />{translateText(" Salvar no cenário")}</Button>
          )
        )}
        {source === "scenario" && doc && !doc.writable && (
          <span className="text-[11px] text-muted-foreground">{translateText("Somente leitura (")}{translateText(doc.location_kind)}{translateText("): só é possível aplicar ao engine.")}</span>
        )}
        <Button size="sm" variant="ghost" onClick={() => void load()} disabled={busy !== null || !dirty}>
          <RotateCcw className="size-3.5" />{translateText(" Descartar alterações")}</Button>
        {dirty && <span className="text-[11px] text-yellow-700 dark:text-yellow-400">{translateText("alterações não salvas")}</span>}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => run("clear", async () => { await onClearEngine(); return "Override do engine removido." })} disabled={busy !== null}>
          <X className="size-3.5" />{translateText(" Limpar override do engine")}</Button>
      </div>
    </div>
  )
}
