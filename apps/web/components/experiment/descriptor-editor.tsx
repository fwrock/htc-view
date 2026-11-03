"use client"

import { useI18n } from "@/components/i18n-provider"

import { useState } from "react"
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import type { Descriptor, ExperimentSchema, Json, Problem, StepDef } from "@/lib/experiment-api"
import { AREA, Field, INPUT, JsonField, KeyValueEditor, LABEL, MatrixEditor } from "./fields"
import { CatalogPicker, ScenarioPicker } from "./pickers"

type Section = "general" | "environment" | "steps" | "variables" | "json"
const SECTIONS: { id: Section; label: string }[] = [
  { id: "general", label: "Geral" },
  { id: "environment", label: "Ambiente" },
  { id: "steps", label: "Passos" },
  { id: "variables", label: "Variáveis e matriz" },
  { id: "json", label: "JSON" },
]
const SPECIAL_ENV = new Set(["kind", "profile", "extends", "env", "settings", "locations", "phases", "hooks"])

export function DescriptorEditor({ descriptor, onChange, schema, problems }: {
  descriptor: Descriptor; onChange: (d: Descriptor) => void; schema: ExperimentSchema | null; problems: Problem[]
}) {
  const { t: translateText } = useI18n()

  const [section, setSection] = useState<Section>("general")
  const count = (prefix: string) => problems.filter((p) => p.path.startsWith(prefix)).length
  const badge: Record<Section, number> = {
    general: problems.filter((p) => ["name", "schema", "description"].includes(p.path)).length,
    environment: count("environment") + count("profiles"),
    steps: count("steps"),
    variables: count("vars") + count("matrix"),
    json: 0,
  }
  return (
    <div className="flex flex-col gap-3">
      <nav className="flex flex-wrap gap-2 border-b pb-2" aria-label={translateText("Seções do descritor")}>
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" aria-pressed={section === s.id} onClick={() => setSection(s.id)}
            className={`rounded-sm border px-3 py-1.5 text-xs ${section === s.id ? "border-primary bg-primary/10" : "border-border"}`}>
            {translateText(s.label)}{badge[s.id] > 0 && <span className="ml-1.5 rounded-sm bg-destructive/15 px-1 text-[10px] text-destructive">{translateText(badge[s.id])}</span>}
          </button>
        ))}
      </nav>
      {section === "general" && <General d={descriptor} onChange={onChange} />}
      {section === "environment" && <Environment d={descriptor} onChange={onChange} schema={schema} />}
      {section === "steps" && <Steps d={descriptor} onChange={onChange} schema={schema} problems={problems} />}
      {section === "variables" && <Variables d={descriptor} onChange={onChange} />}
      {section === "json" && (
        <div className="flex flex-col gap-1">
          <p className="text-[11px] text-muted-foreground">{translateText("O documento inteiro. Perfis (")}<span className="font-mono">{translateText("profiles")}</span>{translateText(") e hooks com lista de argumentos só se editam aqui. Alterações válidas se aplicam na hora.")}</p>
          <JsonField rows={26} value={descriptor as unknown as Json} onChange={(v) => { if (v && typeof v === "object" && !Array.isArray(v)) onChange(v as unknown as Descriptor) }} />
        </div>
      )}
    </div>
  )
}

function HelpBox({ title, lines }: { title: string; lines: [string, string][] }) {
  const { t: translateText } = useI18n()

  return (
    <div className="rounded-sm border border-border bg-muted/30 p-3 text-xs" role="note">
      <p className="mb-1 font-semibold">{translateText(title)}</p>
      <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[auto_1fr]">
        {lines.filter(([, v]) => v).map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{translateText(k)}</dt><dd>{translateText(v)}</dd></div>)}
      </dl>
    </div>
  )
}

function General({ d, onChange }: { d: Descriptor; onChange: (d: Descriptor) => void }) {
  const { t: translateText } = useI18n()

  return (
    <div className="grid max-w-2xl gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="exp-name" className={LABEL}>{translateText("Nome (a-z, 0-9, - e _)")}</label>
        <input id="exp-name" className={INPUT} value={d.name} onChange={(e) => onChange({ ...d, name: e.target.value })} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="exp-desc" className={LABEL}>{translateText("Descrição")}</label>
        <textarea id="exp-desc" className={AREA} rows={3} value={d.description ?? ""} onChange={(e) => onChange({ ...d, description: e.target.value })} />
      </div>
    </div>
  )
}

function Environment({ d, onChange, schema }: { d: Descriptor; onChange: (d: Descriptor) => void; schema: ExperimentSchema | null }) {
  const { t: translateText } = useI18n()

  const env = d.environment
  const set = (key: string, value: Json | undefined) => {
    const next = { ...env }
    if (value === undefined) delete next[key]
    else next[key] = value
    onChange({ ...d, environment: next })
  }
  const kinds = schema ? Object.keys(schema["x-htc-env-fields"]) : ["local", "docker", "vm", "gke", "other"]
  const kind = typeof env.kind === "string" ? env.kind : ""
  const specs = schema?.properties.environment.properties ?? {}
  const fields = (schema?.["x-htc-env-fields"][kind] ?? []).filter((f) => !SPECIAL_ENV.has(f))
  const billable = schema?.["x-htc-billable-kinds"]?.includes(kind)
  const phases = schema?.["x-htc-phases"] ?? []
  const hookPhases = schema?.["x-htc-hook-phases"] ?? []
  const help = schema?.["x-htc-help"]
  const kindHelp = help?.environments[kind]
  const [catalog, setCatalog] = useState<"env" | "settings" | null>(null)
  const addEntry = (which: "env" | "settings", key: string, value: string) => {
    const cur = (env[which] ?? {}) as Record<string, Json>
    set(which, { ...cur, [key]: value } as Json)
    setCatalog(null)
  }
  const phaseMap = (env.phases ?? {}) as Record<string, Json>
  const hooks = (env.hooks ?? {}) as Record<string, Record<string, Json>>
  const setHook = (phase: string, key: string, value: string) => {
    const cur = { ...(hooks[phase] ?? {}) }
    if (value) cur[key] = value
    else delete cur[key]
    const next = { ...hooks }
    if (Object.keys(cur).length) next[phase] = cur
    else delete next[phase]
    set("hooks", Object.keys(next).length ? (next as Json) : undefined)
  }
  return (
    <div className="flex flex-col gap-5">
      <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="env-kind" className={LABEL}>{translateText("Tipo de ambiente")}</label>
          <select id="env-kind" className={INPUT} value={kind} onChange={(e) => set("kind", e.target.value || undefined)}>
            <option value="">{translateText("(definido pelo perfil)")}</option>
            {kinds.map((k) => <option key={k} value={k}>{translateText(k)}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="env-profile" className={LABEL}>{translateText("Perfil (do arquivo ou interno)")}</label>
          <input id="env-profile" className={INPUT} value={typeof env.profile === "string" ? env.profile : ""} onChange={(e) => set("profile", e.target.value || undefined)} />
        </div>
      </div>
      {kindHelp && <div className="max-w-3xl"><HelpBox title={translateText("Ambiente {0}", { 0: kind })} lines={[["O que é", kindHelp.summary], ["Precisa de", kindHelp.needs.join("; ")], ["Custo", kindHelp.cost]]} /></div>}
      {billable && <p className="max-w-3xl rounded-sm border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs">{translateText("Ambiente ")}<b>{translateText(kind)}</b>: <span className="font-mono">{translateText("provision")}</span>{translateText(" e ")}<span className="font-mono">{translateText("teardown")}</span>{translateText(" criam e destroem infraestrutura paga. Defina ")}<span className="font-mono">{translateText("ttl_minutes")}</span>{translateText(" e ")}<span className="font-mono">{translateText("state_dir")}</span>{translateText("; a execução pede confirmação.")}</p>}
      <div className="grid max-w-4xl gap-3 sm:grid-cols-2">
        {fields.map((f) => specs[f] && <Field key={f} id={`env-${f}`} name={f} spec={specs[f]!} value={env[f]} onChange={(v) => set(f, v)} help={translateText(help?.fields[f])} />)}
      </div>
      {([["env", "Variáveis de ambiente do engine (HTC_*)"], ["settings", "Chaves htc.* (application.conf)"], ["locations", "Locais do registro (papel → id)"]] as const).map(([key, title]) => (
        <section key={key} className="max-w-4xl">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <h3 className="text-xs font-semibold">{translateText(title)}</h3>
            {key !== "locations" && <Button type="button" size="sm" variant="outline" onClick={() => setCatalog(key)}>{translateText("Escolher do catálogo")}</Button>}
          </div>
          {help?.fields[key]?.hint && <p className="mb-1.5 text-[11px] text-muted-foreground">{translateText(help.fields[key]!.hint)}</p>}
          <KeyValueEditor asString keyLabel={key === "locations" ? "papel" : "nome"} value={env[key] as Record<string, Json> | undefined} onChange={(v) => set(key, v as Json | undefined)} />
        </section>
      ))}
      {catalog && <CatalogPicker mode={catalog} onClose={() => setCatalog(null)} onPick={(k, v) => addEntry(catalog, k, v)} />}
      <section className="max-w-4xl">
        <h3 className="mb-1.5 text-xs font-semibold">{translateText("Fases")}</h3>
        <p className="mb-2 text-[11px] text-muted-foreground">{translateText("“Padrão” segue o tipo de ambiente. Desligue ")}<span className="font-mono">{translateText("provision")}</span>/<span className="font-mono">{translateText("deploy")}</span>/<span className="font-mono">{translateText("teardown")}</span>{translateText(" para usar um engine que já existe.")}</p>
        <ul className="mb-2 grid gap-x-6 text-[11px] text-muted-foreground sm:grid-cols-2">{phases.map((p) => <li key={p}><span className="font-mono text-foreground">{translateText(p)}</span>: {translateText(help?.phases[p])}</li>)}</ul>
        <div className="flex flex-wrap gap-3">
          {phases.map((p) => (
            <label key={p} className="flex items-center gap-1.5 text-xs" title={translateText(help?.phases[p])}>
              <span className="font-mono">{translateText(p)}</span>
              <select className="h-7 rounded-sm border border-input bg-background px-1 text-xs" value={phaseMap[p] === true ? "on" : phaseMap[p] === false ? "off" : ""}
                onChange={(e) => {
                  const next = { ...phaseMap }
                  if (e.target.value === "") delete next[p]
                  else next[p] = e.target.value === "on"
                  set("phases", Object.keys(next).length ? (next as Json) : undefined)
                }}>
                <option value="">{translateText("padrão")}</option><option value="on">{translateText("ligada")}</option><option value="off">{translateText("desligada")}</option>
              </select>
            </label>
          ))}
        </div>
      </section>
      <section className="max-w-4xl">
        <h3 className="mb-1.5 text-xs font-semibold">{translateText("Hooks (comandos próprios por fase)")}</h3>
        <p className="mb-2 text-[11px] text-muted-foreground"><span className="font-mono">{translateText("override")}</span>{translateText(" substitui a ação padrão da fase. ")}<span className="font-mono">{translateText("restart")}</span>: {translateText(help?.phases.restart)}{translateText(" Rodam no seu ambiente: só use descritores em que confia.")}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-2 font-normal">{translateText("fase")}</th><th className="px-1 font-normal">{translateText("before")}</th><th className="px-1 font-normal">{translateText("override")}</th><th className="px-1 font-normal">{translateText("after")}</th></tr></thead>
            <tbody>
              {hookPhases.map((p) => (
                <tr key={p}>
                  <td className="py-1 pr-2 font-mono">{translateText(p)}</td>
                  {(["before", "override", "after"] as const).map((k) => (
                    <td key={k} className="px-1 py-0.5">
                      <input className={`${INPUT} font-mono`} aria-label={translateText("{0} {1}", { 0: p, 1: k })} value={typeof hooks[p]?.[k] === "string" ? (hooks[p]![k] as string) : Array.isArray(hooks[p]?.[k]) ? JSON.stringify(hooks[p]![k]) : ""}
                        onChange={(e) => setHook(p, k, e.target.value)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function uniqueId(base: string, steps: StepDef[]) {
  let n = 1
  while (steps.some((s) => s.id === (n === 1 ? base : `${base}${n}`))) n++
  return n === 1 ? base : `${base}${n}`
}

function Steps({ d, onChange, schema, problems }: { d: Descriptor; onChange: (d: Descriptor) => void; schema: ExperimentSchema | null; problems: Problem[] }) {
  const { t: translateText } = useI18n()

  const [sel, setSel] = useState(0)
  const steps = d.steps
  const cur = steps[Math.min(sel, steps.length - 1)]
  const idx = cur ? steps.indexOf(cur) : -1
  const types = schema?.properties.steps.items.oneOf.map((o) => ({ type: o.properties.type.const, title: o.title, params: o.properties.params })) ?? []
  const typeInfo = types.find((t) => t.type === cur?.type)
  const help = schema?.["x-htc-help"]
  const stepHelp = cur ? help?.steps[cur.type] : undefined
  const axes = Object.keys(d.matrix ?? {})
  const setSteps = (next: StepDef[]) => onChange({ ...d, steps: next })
  const patch = (p: Partial<StepDef>) => setSteps(steps.map((s, i) => (i === idx ? { ...s, ...p } : s)))
  const stepProblems = (id: string) => problems.filter((p) => p.path.startsWith(`steps[${id}`))

  function rename(newId: string) {
    const old = cur!.id
    setSteps(steps.map((s, i) => ({ ...s, id: i === idx ? newId : s.id, needs: s.needs?.map((n) => (n === old ? newId : n)) })))
  }
  function remove() {
    const old = cur!.id
    setSteps(steps.filter((_, i) => i !== idx).map((s) => ({ ...s, needs: s.needs?.filter((n) => n !== old) })))
    setSel(Math.max(0, idx - 1))
  }
  function move(delta: number) {
    const j = idx + delta
    if (j < 0 || j >= steps.length) return
    const next = [...steps]
    ;[next[idx], next[j]] = [next[j]!, next[idx]!]
    setSteps(next)
    setSel(j)
  }
  function add(type: string) {
    if (!type) return
    const id = uniqueId(type.replace(/_/g, "-"), steps)
    setSteps([...steps, { id, type, needs: [], params: {} }])
    setSel(steps.length)
  }
  const prune = (o: Record<string, Json>) => (Object.keys(o).length ? o : undefined)

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
      <div className="flex flex-col gap-2">
        <ol className="flex flex-col gap-1" aria-label={translateText("Passos")}>
          {steps.map((s, i) => (
            <li key={`${s.id}-${i}`}>
              <button type="button" aria-current={i === idx} onClick={() => setSel(i)}
                className={`flex w-full items-center justify-between gap-2 rounded-sm border px-2 py-1.5 text-left text-xs ${i === idx ? "border-primary bg-primary/10" : "border-border"} ${s.enabled === false ? "opacity-50" : ""}`}>
                <span className="truncate"><span className="font-mono">{translateText(s.id)}</span> <span className="text-muted-foreground">{translateText(s.type)}</span></span>
                {stepProblems(s.id).length > 0 && <span className="rounded-sm bg-destructive/15 px-1 text-[10px] text-destructive">{translateText(stepProblems(s.id).length)}</span>}
              </button>
            </li>
          ))}
        </ol>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>{translateText("Adicionar passo")}</span>
          <select className={INPUT} value="" onChange={(e) => add(e.target.value)}>
            <option value="">{translateText("escolher o tipo…")}</option>
            {types.map((t) => <option key={t.type} value={t.type}>{translateText(t.type)} — {translateText(t.title)}</option>)}
          </select>
        </label>
      </div>
      {cur && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1"><span className={LABEL}>{translateText("id")}</span>
              <input className={`${INPUT} w-44 font-mono`} value={cur.id} onChange={(e) => rename(e.target.value)} /></label>
            <label className="flex flex-col gap-1"><span className={LABEL}>{translateText("tipo")}</span>
              <select className={`${INPUT} w-56`} value={cur.type} onChange={(e) => patch({ type: e.target.value, params: {} })}>
                {types.map((t) => <option key={t.type} value={t.type}>{translateText(t.type)}</option>)}
              </select></label>
            <Button type="button" size="sm" variant="outline" aria-label={translateText("Subir passo")} onClick={() => move(-1)} disabled={idx === 0}><ArrowUp className="size-3.5" /></Button>
            <Button type="button" size="sm" variant="outline" aria-label={translateText("Descer passo")} onClick={() => move(1)} disabled={idx === steps.length - 1}><ArrowDown className="size-3.5" /></Button>
            <Button type="button" size="sm" variant="outline" onClick={remove}><Trash2 className="size-3.5" />{translateText(" Remover")}</Button>
          </div>
          {stepHelp && <HelpBox title={translateText(types.find((t) => t.type === cur.type)?.title ?? cur.type)} lines={[["O que faz", stepHelp.summary], ["Precisa de", stepHelp.needs], ["Produz", stepHelp.produces], ["Dica", stepHelp.tip]]} />}
          <div className="grid gap-3 sm:grid-cols-2">
            <fieldset className="flex flex-col gap-1"><legend className={LABEL}>{translateText("Depende de (needs)")}</legend>
              <div className="flex flex-wrap gap-3">
                {steps.filter((s) => s.id !== cur.id).map((s) => (
                  <label key={s.id} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={cur.needs?.includes(s.id) ?? false}
                    onChange={(e) => patch({ needs: e.target.checked ? [...(cur.needs ?? []), s.id] : (cur.needs ?? []).filter((n) => n !== s.id) })} /> <span className="font-mono">{translateText(s.id)}</span></label>
                ))}
                {steps.length < 2 && <span className="text-[11px] text-muted-foreground">{translateText("nenhum outro passo")}</span>}
              </div></fieldset>
            <fieldset className="flex flex-col gap-1"><legend className={LABEL}>{translateText("Expande sobre a matriz (eixos)")}</legend>
              <div className="flex flex-wrap gap-3">
                {axes.map((a) => (
                  <label key={a} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={cur.matrix?.includes(a) ?? false}
                    onChange={(e) => patch({ matrix: e.target.checked ? [...(cur.matrix ?? []), a] : (cur.matrix ?? []).filter((n) => n !== a) })} /> <span className="font-mono">{translateText(a)}</span></label>
                ))}
                {axes.length === 0 && <span className="text-[11px] text-muted-foreground">{translateText("defina eixos em “Variáveis e matriz”")}</span>}
              </div></fieldset>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={cur.enabled !== false} onChange={(e) => patch({ enabled: e.target.checked ? undefined : false })} />{translateText(" ativo")}</label>
            <label className="flex flex-col gap-1"><span className={LABEL}>{translateText("em falha")}</span>
              <select className={`${INPUT} w-36`} value={cur.on_failure ?? ""} onChange={(e) => patch({ on_failure: (e.target.value || undefined) as StepDef["on_failure"] })}>
                <option value="">{translateText("interromper (padrão)")}</option><option value="continue">{translateText("continuar")}</option></select></label>
            <label className="flex flex-col gap-1"><span className={LABEL}>{translateText("tentativas extras")}</span>
              <input className={`${INPUT} w-24`} type="number" min={0} value={cur.retries ?? ""} onChange={(e) => patch({ retries: e.target.value === "" ? undefined : Number(e.target.value) })} /></label>
            <label className="flex flex-col gap-1"><span className={LABEL}>{translateText("limite (s)")}</span>
              <input className={`${INPUT} w-28`} type="number" min={1} value={cur.timeout_s ?? ""} onChange={(e) => patch({ timeout_s: e.target.value === "" ? undefined : Number(e.target.value) })} /></label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {Object.entries(typeInfo?.params.properties ?? {}).map(([name, spec]) => (
              <Field key={`${cur.id}-${name}`} id={`p-${cur.id}-${name}`} name={name} spec={spec} required={typeInfo?.params.required?.includes(name)}
                help={translateText(help?.fields[name])}
                control={name === "scenario" ? <ScenarioPicker id={`p-${cur.id}-${name}`} value={typeof cur.params?.[name] === "string" ? (cur.params[name] as string) : ""}
                  onChange={(x) => patch({ params: { ...(cur.params ?? {}), ...(x ? { scenario: x } : {}) } })} /> : undefined}
                value={cur.params?.[name]} onChange={(v) => {
                  const next = { ...(cur.params ?? {}) }
                  if (v === undefined) delete next[name]
                  else next[name] = v
                  patch({ params: prune(next) ?? {} })
                }} />
            ))}
          </div>
          {stepProblems(cur.id).length > 0 && (
            <ul className="rounded-sm border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive" role="alert">
              {stepProblems(cur.id).map((p, i) => <li key={i}><span className="font-mono">{translateText(p.path)}</span>: {translateText(p.message)}</li>)}
            </ul>
          )}
        </div>
      )}
      {!cur && <p className="text-xs text-muted-foreground">{translateText("Sem passos. Adicione um.")}</p>}
    </div>
  )
}

function Variables({ d, onChange }: { d: Descriptor; onChange: (d: Descriptor) => void }) {
  const { t: translateText } = useI18n()

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <section>
        <h3 className="mb-1 text-xs font-semibold">{translateText("Variáveis")}</h3>
        <p className="mb-2 text-[11px] text-muted-foreground">{translateText("Use ")}<span className="font-mono">{translateText("${nome}")}</span>{translateText(" em qualquer valor. Sozinho, mantém o tipo (número continua número). Valores em JSON.")}</p>
        <KeyValueEditor addLabel={translateText("Adicionar variável")} value={d.vars} onChange={(v) => onChange({ ...d, vars: v ?? {} })} />
      </section>
      <section>
        <h3 className="mb-1 text-xs font-semibold">{translateText("Matriz")}</h3>
        <p className="mb-2 text-[11px] text-muted-foreground">{translateText("Cada eixo é uma lista de valores. Um passo marcado com eixos vira uma instância por combinação, e o cache é por instância.")}</p>
        <MatrixEditor value={d.matrix} onChange={(v) => onChange({ ...d, matrix: v ?? {} })} />
      </section>
    </div>
  )
}
