"use client"

import { useI18n } from "@/components/i18n-provider"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { ActorForm, defaultActor, diffActor } from "@/components/schemas/actor-form"
import {
  getActorSchemas,
  getAllScenarios,
  readScenarioActor,
  type ActorSchemas,
  type ScenarioActor,
  listModificationFiles,
  readModificationFile,
  validateModifications,
  writeModificationFile,
  type ModOp,
  type Modifications,
  type ModificationsReport,
} from "@/lib/simedape-api"

const input = "h-8 w-full rounded-sm border border-input bg-background px-2 text-xs focus:border-ring focus:ring-1 focus:ring-ring/30 focus:outline-none"
const small = "h-7 rounded-sm border border-input bg-background px-2 text-xs"
const PREDICATES = ["==", "!=", "<", "<=", ">", ">=", "in"]
const MAP_OPS = ["map.add_node", "map.remove_node", "map.edit_node", "map.add_edge", "map.remove_edge", "map.edit_edge"]
const EMPTY: Modifications = { schema: "htc.modifications.v1", name: "", description: "", operations: [] }

type Where = { path: string; op: string; value: unknown }
const asValue = (t: string): unknown => {
  const v = t.trim()
  if (v === "") return ""
  try {
    return JSON.parse(v)
  } catch {
    return v
  }
}
const showValue = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v))

/** Editor for scenario modifications with a live validator. Standalone page and embeddable (SimEDaPE step). */
export function ModificationsEditor({ scenarioRef: fixedRef, initialRef, embedded, onSaved }: { scenarioRef?: string; initialRef?: string; embedded?: boolean; onSaved?: (name: string) => void }) {
  const { t: translateText, intlLocale } = useI18n()

  const [scenarios, setScenarios] = useState<{ ref: string; label: string }[]>([])
  const [ref, setRef] = useState(fixedRef ?? initialRef ?? "")
  const [files, setFiles] = useState<string[]>([])
  const [fileName, setFileName] = useState("")
  const [mods, setMods] = useState<Modifications>(EMPTY)
  const [mode, setMode] = useState<"ops" | "json">("ops")
  const [raw, setRaw] = useState("")
  const [rawError, setRawError] = useState<string | null>(null)
  const [report, setReport] = useState<ModificationsReport | null>(null)
  const [validating, setValidating] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Actor descriptors (JSON Schema + x-htc-*): field suggestions here and the generated actor form
  const [schemas, setSchemas] = useState<ActorSchemas | null>(null)
  const [actorId, setActorId] = useState("")
  const [actor, setActor] = useState<ScenarioActor | null>(null)
  const [actorBase, setActorBase] = useState<ScenarioActor | null>(null)
  const [cloneId, setCloneId] = useState("")
  const [actorError, setActorError] = useState<string | null>(null)
  useEffect(() => {
    getActorSchemas().then(setSchemas).catch(() => setSchemas(null))
  }, [])
  const allPaths = useMemo(() => {
    const m = new Map<string, string>()
    for (const fields of Object.values(schemas?.catalog ?? {})) for (const f of fields) if (f.editable && !m.has(f.path)) m.set(f.path, `${f.label}${f.unit ? ` (${f.unit})` : ""}`)
    return [...m.entries()]
  }, [schemas])
  const unitOf = (path: string) => Object.values(schemas?.catalog ?? {}).flat().find((f) => f.path === path)?.unit ?? null
  const actorClass = actor ? Object.keys(schemas?.actors ?? {}).find((c) => c === actor.typeActor || c.endsWith("." + actor.typeActor.split(".").pop())) : undefined

  useEffect(() => {
    if (fixedRef !== undefined) setRef(fixedRef)
  }, [fixedRef])
  useEffect(() => {
    if (fixedRef) return
    getAllScenarios().then((r) => setScenarios(r.scenarios.map((x) => ({ ref: x.ref, label: `${x.title || x.name} · ${x.location_label}` })))).catch(() => setScenarios([]))
  }, [fixedRef])

  const refreshFiles = useCallback(() => {
    if (!ref) return setFiles([])
    listModificationFiles(ref).then((r) => setFiles(r.files)).catch(() => setFiles([]))   // typing a half-written ref is not an error to show
  }, [ref])
  useEffect(refreshFiles, [refreshFiles])

  // live validation (debounced)
  useEffect(() => {
    if (!ref) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setValidating(true)
      validateModifications(ref, mods).then(setReport).catch((e) => setReport({ ok: false, errors: [(e as Error).message], warnings: [], operations: [], summary: { actors_in_base: 0, max_id: 0, added: 0, removed: 0, affected_by_op: {}, operations: 0 } })).finally(() => setValidating(false))
    }, 500)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [ref, mods])

  const update = (fn: (m: Modifications) => Modifications) => setMods((m) => fn(m))
  const setOp = (i: number, op: ModOp) => update((m) => ({ ...m, operations: m.operations.map((o, j) => (j === i ? op : o)) }))
  const addOp = (op: ModOp) => update((m) => ({ ...m, operations: [...m.operations, op] }))
  const removeOp = (i: number) => update((m) => ({ ...m, operations: m.operations.filter((_, j) => j !== i) }))
  const move = (i: number, d: -1 | 1) => update((m) => {
    const ops = [...m.operations]
    const k = i + d
    if (k < 0 || k >= ops.length) return m
    ;[ops[i], ops[k]] = [ops[k]!, ops[i]!]
    return { ...m, operations: ops }
  })

  async function loadActor() {
    setActorError(null)
    try {
      const r = await readScenarioActor(ref, Number(actorId))
      setActor(structuredClone(r.actor))
      setActorBase(structuredClone(r.actor))
      setCloneId("")
    } catch (e) {
      setActor(null)
      setActorBase(null)
      setActorError((e as Error).message)
    }
  }
  function applyActorEdit() {
    if (!actor || !actorBase || !actorClass || !schemas) return
    const changes = diffActor(actorBase, actor, schemas.catalog[actorClass] ?? [])
    if (Object.keys(changes).length === 0) return setActorError("Nenhum campo foi alterado.")
    addOp({ op: "edit", ids: [actor.id], set: changes })
    setActorBase(structuredClone(actor))
    setActorError(null)
  }
  function applyActorClone() {
    if (!actor || !Number(cloneId)) return setActorError("Informe o id do novo ator.")
    addOp({ op: "add", actor: { ...structuredClone(actor), id: Number(cloneId) } })
    setActorError(null)
  }

  async function open(name: string) {
    setMessage(null)
    try {
      const r = await readModificationFile(ref, name)
      setMods({ ...EMPTY, ...r.content, operations: r.content.operations ?? [] })
      setFileName(name)
    } catch (e) {
      setMessage((e as Error).message)
    }
  }
  async function save() {
    setSaving(true)
    setMessage(null)
    try {
      const name = fileName.trim().endsWith(".json") ? fileName.trim() : `${fileName.trim()}.json`
      await writeModificationFile(ref, name, mods)
      setFileName(name)
      setMessage(`Salvo em ${ref} → modifications/${name}`)
      refreshFiles()
      onSaved?.(name)
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const reportFor = useMemo(() => new Map((report?.operations ?? []).map((o) => [o.index, o])), [report])

  function opCard(op: ModOp, i: number) {
    const info = reportFor.get(i)
    const isMap = MAP_OPS.includes(op.op)
    const target = "select" in op ? "select" : "ids"
    const select = (op.select ?? {}) as { class?: string; ids?: number[]; where?: Where[] }
    const setSelect = (s: typeof select) => setOp(i, { ...op, select: s })
    const modeKeys = (["set", "scale", "add"] as const).filter((k) => k in op)
    return (
      <li key={i} className="flex flex-col gap-2 rounded-sm border border-border p-3">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-mono text-muted-foreground">#{translateText(i)}</span>
          {isMap ? <span className="font-mono">{translateText(op.op)}</span> : (
            <select className={small} value={op.op} onChange={(e) => setOp(i, { op: e.target.value, ...(e.target.value === "add" ? { actor: {} } : { ids: [] }) })}>
              <option value="edit">{translateText("Editar")}</option><option value="remove">{translateText("Remover")}</option><option value="add">{translateText("Adicionar ator")}</option>
            </select>
          )}
          {info && info.matches !== null && <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px]">{translateText(info.matches)}{translateText(" ator(es)")}{info.sample.length ? translateText(" · ex.: {0}", { 0: info.sample.join(", ") }) : translateText("")}</span>}
          <span className="ml-auto flex gap-1">
            <button type="button" onClick={() => move(i, -1)} className="rounded-sm p-1 hover:bg-muted" aria-label={translateText("Subir")}><ArrowUp className="size-3.5" /></button>
            <button type="button" onClick={() => move(i, 1)} className="rounded-sm p-1 hover:bg-muted" aria-label={translateText("Descer")}><ArrowDown className="size-3.5" /></button>
            <button type="button" onClick={() => removeOp(i)} className="rounded-sm p-1 text-destructive hover:bg-muted" aria-label={translateText("Remover operação")}><Trash2 className="size-3.5" /></button>
          </span>
        </div>
        {isMap && <p className="text-[11px] text-yellow-600 dark:text-yellow-400">{translateText("Operação de mapa/infraestrutura: reservada (ainda não é validada nem aplicada). Edite no modo JSON.")}</p>}
        {!isMap && op.op === "add" && (() => {
          const a = (op.actor ?? {}) as ScenarioActor
          const cls = schemas ? Object.keys(schemas.actors).find((c) => c === a.typeActor) : undefined
          const nextId = (report?.summary.max_id ?? 0) + 1 + i
          const start = (c: string) => {
            if (!schemas) return
            setOp(i, { ...op, actor: defaultActor(schemas.actors[c]!, schemas.catalog[c] ?? [], Number(a.id) || nextId) })
          }
          return (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-end gap-2 text-xs">
                <label className="flex flex-col gap-1">{translateText("Classe do ator")}<select className={small} value={cls ?? ""} onChange={(e) => e.target.value && start(e.target.value)}>
                    <option value="">{translateText("Escolha…")}</option>
                    {Object.entries(schemas?.actors ?? {}).map(([c, sc]) => <option key={c} value={c}>{translateText(sc.title)}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1">{translateText("Id do novo ator")}<input type="number" className={cn(small, "w-32 font-mono")} value={typeof a.id === "number" ? a.id : ""} placeholder={translateText(String(nextId))} onChange={(e) => setOp(i, { ...op, actor: { ...a, id: Number(e.target.value) } })} />
                </label>
                {!schemas && <span className="text-[11px] text-yellow-600">{translateText("descritores indisponíveis: use o modo JSON")}</span>}
              </div>
              {cls && schemas ? (
                <ActorForm actor={a} schema={schemas.actors[cls]!} catalog={schemas.catalog[cls] ?? []} onChange={(next) => setOp(i, { ...op, actor: next })} />
              ) : (
                <p className="text-[11px] text-muted-foreground">{translateText("Escolha a classe para gerar o formulário com os campos dela. ")}{a.typeActor && !cls ? translateText("(Esta classe, {0}, ainda não tem descritor: edite no modo JSON.)", { 0: a.typeActor }) : translateText("")}</p>
              )}
            </div>
          )
        })()}
        {!isMap && (op.op === "edit" || op.op === "remove") && (
          <>
            <div className="flex gap-3 text-[11px]">
              {(["ids", "select"] as const).map((t) => (
                <label key={t} className="flex items-center gap-1"><input type="radio" checked={target === t} onChange={() => {
                  const { ids: _ids, select: _select, ...rest } = op
                  setOp(i, t === "ids" ? { ...rest, ids: [] } : { ...rest, select: { class: "" } })
                }} />{t === "ids" ? translateText("Por ids") : translateText("Por seletor")}</label>
              ))}
            </div>
            {target === "ids" ? (
              <input className={cn(input, "font-mono")} placeholder={translateText("ids separados por vírgula, ex.: 6, 7, 12")} defaultValue={((op.ids as number[]) ?? []).join(", ")} key={`ids-${i}-${JSON.stringify(op.ids)}`}
                onBlur={(e) => setOp(i, { ...op, ids: e.target.value.split(/[ ,;]+/).filter(Boolean).map(Number) })} />
            ) : (
              <div className="flex flex-col gap-1.5">
                <div className="flex gap-2">
                  <input className={cn(input, "font-mono")} placeholder={translateText("classe (ex.: Link, Car)")} value={select.class ?? ""} onChange={(e) => setSelect({ ...select, class: e.target.value || undefined })} />
                  <input className={cn(input, "font-mono")} placeholder={translateText("ids (opcional)")} defaultValue={(select.ids ?? []).join(", ")} key={`sids-${i}`} onBlur={(e) => { const ids = e.target.value.split(/[ ,;]+/).filter(Boolean).map(Number); setSelect({ ...select, ids: ids.length ? ids : undefined }) }} />
                </div>
                {(select.where ?? []).map((w, k) => (
                  <div key={k} className="flex gap-1.5">
                    <input list="mod-paths" className={cn(small, "flex-1 font-mono")} placeholder={translateText("data.content.lanes")} value={w.path} onChange={(e) => setSelect({ ...select, where: (select.where ?? []).map((x, j) => (j === k ? { ...x, path: e.target.value } : x)) })} />
                    <select className={small} value={w.op} onChange={(e) => setSelect({ ...select, where: (select.where ?? []).map((x, j) => (j === k ? { ...x, op: e.target.value } : x)) })}>{PREDICATES.map((p) => <option key={p}>{translateText(p)}</option>)}</select>
                    <input className={cn(small, "w-28 font-mono")} defaultValue={showValue(w.value)} key={`w-${i}-${k}`} onBlur={(e) => setSelect({ ...select, where: (select.where ?? []).map((x, j) => (j === k ? { ...x, value: asValue(e.target.value) } : x)) })} />
                    <button type="button" className="px-1 text-destructive" onClick={() => setSelect({ ...select, where: (select.where ?? []).filter((_, j) => j !== k) })}>{translateText("×")}</button>
                  </div>
                ))}
                <button type="button" className="self-start text-[11px] underline" onClick={() => setSelect({ ...select, where: [...(select.where ?? []), { path: "", op: "==", value: "" }] })}>{translateText("+ condição (where)")}</button>
              </div>
            )}
          </>
        )}
        {!isMap && op.op === "edit" && (
          <div className="flex flex-col gap-1.5">
            {modeKeys.flatMap((k) => Object.entries(op[k] as Record<string, unknown>).map(([path, val]) => (
              <div key={`${k}-${path}`} className="flex gap-1.5">
                <select className={small} value={k} onChange={(e) => {
                  const nk = e.target.value as "set" | "scale" | "add"
                  const next = { ...op } as Record<string, unknown>
                  const old = { ...(next[k] as Record<string, unknown>) }
                  delete old[path]
                  if (Object.keys(old).length) next[k] = old; else delete next[k]
                  next[nk] = { ...((next[nk] as Record<string, unknown>) ?? {}), [path]: val }
                  setOp(i, next as ModOp)
                }}><option value="set">{translateText("definir")}</option><option value="scale">{translateText("multiplicar")}</option><option value="add">{translateText("somar")}</option></select>
                <input list="mod-paths" className={cn(small, "flex-1 font-mono")} defaultValue={path} key={`p-${i}-${k}-${path}`} onBlur={(e) => {
                  const np = e.target.value.trim()
                  if (!np || np === path) return
                  const cur = { ...(op[k] as Record<string, unknown>) }
                  delete cur[path]
                  setOp(i, { ...op, [k]: { ...cur, [np]: val } })
                }} />
                {unitOf(path) && <span className="self-center text-[10px] text-muted-foreground">{translateText(unitOf(path))}</span>}
                <input className={cn(small, "w-28 font-mono")} defaultValue={showValue(val)} key={`v-${i}-${k}-${path}-${showValue(val)}`} onBlur={(e) => setOp(i, { ...op, [k]: { ...(op[k] as Record<string, unknown>), [path]: asValue(e.target.value) } })} />
                <button type="button" className="px-1 text-destructive" onClick={() => {
                  const cur = { ...(op[k] as Record<string, unknown>) }
                  delete cur[path]
                  const next = { ...op } as Record<string, unknown>
                  if (Object.keys(cur).length) next[k] = cur; else delete next[k]
                  setOp(i, next as ModOp)
                }}>{translateText("×")}</button>
              </div>
            )))}
            <button type="button" className="self-start text-[11px] underline" onClick={() => setOp(i, { ...op, set: { ...((op.set as Record<string, unknown>) ?? {}), "data.content.": 0 } })}>{translateText("+ campo a alterar")}</button>
          </div>
        )}
      </li>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {!embedded && <p className="text-xs text-muted-foreground">{translateText("Alterações de um cenário sem tocar nos dados dele: adicionar, remover ou editar atores, uma a uma ou por regra. O arquivo fica em ")}<code className="font-mono">modifications/</code>{translateText(" ao lado do cenário e é checado enquanto você edita.")}</p>}
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
        {fixedRef === undefined && (
          <label className="flex flex-col gap-1 text-xs">{translateText("Cenário base")}<input className={cn(input, "font-mono")} list="mod-scenarios" placeholder={translateText("Escolha da lista, ex.: repo:meu-cenario")} value={ref} onChange={(e) => setRef(e.target.value)} />
            <datalist id="mod-scenarios">{scenarios.map((s) => <option key={s.ref} value={s.ref} label={translateText(s.label)} />)}</datalist>
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs">{translateText("Arquivo de modificações")}<span className="flex gap-2">
            <select className={input} value={files.includes(fileName) ? fileName : ""} onChange={(e) => e.target.value && void open(e.target.value)} disabled={!ref}>
              <option value="">{files.length ? translateText("Abrir existente…") : translateText("Nenhum arquivo ainda")}</option>
              {files.map((f) => <option key={f} value={f}>{translateText(f)}</option>)}
            </select>
            <Button size="sm" variant="outline" type="button" onClick={() => { setMods(EMPTY); setFileName(""); setReport(null) }}>{translateText("Novo")}</Button>
          </span>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs">{translateText("Nome do arquivo")}<input className={cn(input, "font-mono")} placeholder={translateText("meia-velocidade.json")} value={fileName} onChange={(e) => setFileName(e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-xs">{translateText("Título")}<input className={input} value={mods.name ?? ""} onChange={(e) => update((m) => ({ ...m, name: e.target.value }))} /></label>
      </div>

      <div className="flex gap-1 border-b border-border">
        {([["ops", "Operações"], ["json", "JSON"]] as const).map(([id, label]) => (
          <button key={id} type="button" onClick={() => { if (id === "json") { setRaw(JSON.stringify(mods, null, 2)); setRawError(null) } setMode(id) }}
            className={cn("-mb-px border-b-2 px-3 py-1.5 text-xs", mode === id ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>{translateText(label)}</button>
        ))}
      </div>

      {mode === "ops" ? (
        <>
          <ul className="flex flex-col gap-2">{translateText(mods.operations.map((op, i) => opCard(op, i)))}</ul>
          {mods.operations.length === 0 && <p className="text-[11px] text-muted-foreground">{translateText("Nenhuma operação ainda.")}</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" type="button" onClick={() => addOp({ op: "edit", select: { class: "Link" }, scale: { "data.content.speedLimit": 0.5 } })}><Plus className="size-3.5" />{translateText(" Editar")}</Button>
            <Button size="sm" variant="outline" type="button" onClick={() => addOp({ op: "remove", ids: [] })}><Plus className="size-3.5" />{translateText(" Remover")}</Button>
            <Button size="sm" variant="outline" type="button" onClick={() => {
              const first = schemas ? (Object.keys(schemas.actors).find((c) => c.endsWith(".Link")) ?? Object.keys(schemas.actors)[0]) : undefined
              addOp({ op: "add", actor: first && schemas ? defaultActor(schemas.actors[first]!, schemas.catalog[first] ?? [], (report?.summary.max_id ?? 0) + 1 + mods.operations.length) : {} })
            }}><Plus className="size-3.5" />{translateText(" Adicionar ator")}</Button>
            <a className="rounded-sm border px-3 py-2 text-xs" target="_blank" rel="noreferrer" href={`/modifications?ref=${encodeURIComponent(ref)}`}>{translateText("Editor de entidades e mapa ↗")}</a>
          </div>
          <datalist id="mod-paths">{allPaths.map(([path, label]) => <option key={path} value={path} label={translateText(label)} />)}</datalist>

          <details className="rounded-sm border border-border p-3" open={!!actor}>
            <summary className="cursor-pointer text-xs font-medium">{translateText("Editar um ator por formulário (gerado pelo descritor)")}</summary>
            <div className="mt-3 flex flex-col gap-3">
              <p className="text-[11px] text-muted-foreground">{translateText("Carregue um ator do cenário pelo id, edite os campos (cada tipo de campo vem do descritor: unidade, valores permitidos, referências) e gere a operação: só o que mudou vira um ")}<code className="font-mono">edit</code>{translateText("; ou clone o ator como um novo (")}<code className="font-mono">add</code>).</p>
              <div className="flex gap-2">
                <input className={cn(input, "w-40 font-mono")} placeholder={translateText("id do ator")} value={actorId} onChange={(e) => setActorId(e.target.value)} />
                <Button size="sm" variant="outline" type="button" disabled={!ref || !actorId.trim()} onClick={() => void loadActor()}>{translateText("Carregar")}</Button>
                {schemas === null && <span className="self-center text-[11px] text-yellow-600">{translateText("descritores indisponíveis")}</span>}
              </div>
              {actorError && <p className="text-[11px] text-destructive">{translateText(actorError)}</p>}
              {actor && actorClass && schemas && (
                <>
                  <p className="text-xs"><b>{translateText(schemas.actors[actorClass]!.title)}</b>{translateText(" · id ")}{translateText(actor.id)} <span className="text-muted-foreground">· {schemas.actors[actorClass]!["x-htc-filterable"] ? translateText("o filtro parcial pode removê-lo") : translateText("sempre mantido na parcial")}</span></p>
                  <ActorForm actor={actor} schema={schemas.actors[actorClass]!} catalog={schemas.catalog[actorClass] ?? []} onChange={setActor} />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" type="button" onClick={applyActorEdit}>{translateText("Gerar operação de edição")}</Button>
                    <input className={cn(small, "w-36 font-mono")} placeholder={translateText("id do clone")} value={cloneId} onChange={(e) => setCloneId(e.target.value)} />
                    <Button size="sm" variant="outline" type="button" onClick={applyActorClone}>{translateText("Clonar como novo ator")}</Button>
                  </div>
                </>
              )}
              {actor && !actorClass && <p className="text-[11px] text-muted-foreground">{translateText("Esta classe (")}{translateText(actor.typeActor)}{translateText(") ainda não tem descritor; use as operações acima ou o JSON.")}</p>}
            </div>
          </details>
        </>
      ) : (
        <>
          <textarea className={cn(input, "h-72 font-mono")} value={raw} spellCheck={false}
            onChange={(e) => { setRaw(e.target.value); try { const p = JSON.parse(e.target.value); setMods({ ...EMPTY, ...p }); setRawError(null) } catch (err) { setRawError((err as Error).message) } }} />
          {rawError && <p className="text-[11px] text-destructive">{translateText("JSON inválido: ")}{translateText(rawError)}</p>}
        </>
      )}

      <div className={cn("rounded-sm border p-3 text-xs", !ref ? "border-border" : report?.ok ? "border-green-500/40 bg-green-500/5" : report ? "border-destructive/40 bg-destructive/5" : "border-border")}>
        <p className="mb-1 flex items-center gap-2 font-medium">{translateText("Validação ")}{validating && <Loader2 className="size-3 animate-spin" />}
          {report && <span className={cn("rounded-sm px-1.5 py-0.5 text-[10px] uppercase", report.ok ? "bg-green-500/15 text-green-700 dark:text-green-400" : "bg-destructive/15 text-destructive")}>{report.ok ? translateText("válido") : translateText("{0} erro(s)", { 0: report.errors.length })}</span>}
        </p>
        {!ref && <p className="text-muted-foreground">{translateText("Escolha o cenário base para validar.")}</p>}
        {report && (
          <>
            <p className="text-[11px] text-muted-foreground">{translateText(report.summary.actors_in_base.toLocaleString(intlLocale))}{translateText(" atores no cenário · ")}{translateText(report.summary.operations)}{translateText(" operação(ões) · +")}{translateText(report.summary.added)}{translateText(" adicionados · −")}{translateText(report.summary.removed)}{translateText(" removidos")}</p>
            <ul className="mt-1 list-disc pl-4">
              {report.errors.map((e, i) => <li key={`e${i}`} className="text-destructive">{translateText(e)}</li>)}
              {report.warnings.map((w, i) => <li key={`w${i}`} className="text-yellow-700 dark:text-yellow-400">{translateText(w)}</li>)}
            </ul>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={!ref || !fileName.trim() || saving || !!rawError} onClick={() => void save()}>{saving ? <Loader2 className="size-3.5 animate-spin" /> : null}{translateText(" Salvar")}</Button>
        {report && !report.ok && <span className="text-[11px] text-muted-foreground">{translateText("Dá para salvar com erros (rascunho), mas o engine só aplicará um arquivo válido.")}</span>}
        {message && <span className="text-[11px] text-muted-foreground">{translateText(message)}</span>}
      </div>
    </div>
  )
}
