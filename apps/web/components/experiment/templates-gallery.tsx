"use client"

import { useI18n } from "@/components/i18n-provider"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { ApiError, getTemplates, renderTemplate, type Descriptor, type ExperimentsStatus, type Json, type TemplateInfo, type TemplateVar } from "@/lib/experiment-api"
import { INPUT, LABEL } from "./fields"
import { LocationPicker, PathInput, ScenarioPicker } from "./pickers"

const TAG: Record<TemplateInfo["verified"], { text: string; cls: string; help: string }> = {
  verificado: { text: "verificado", cls: "bg-green-500/15 text-green-700 dark:text-green-400", help: "Rodou de verdade com componentes reais." },
  parcial: { text: "verificado em partes", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400", help: "As peças foram verificadas separadas; a ligação entre elas, não." },
  "nao-executavel": { text: "ainda não executa", cls: "bg-destructive/15 text-destructive", help: "Valida e planeja, mas não roda ainda." },
}

function initial(t: TemplateInfo, defaults: Record<string, string>): Record<string, Json> {
  const out: Record<string, Json> = {}
  for (const v of t.variables) {
    if (defaults[v.name] !== undefined) out[v.name] = defaults[v.name]!
    else if (v.default !== undefined) out[v.name] = v.default
  }
  return out
}
const visible = (v: TemplateVar, values: Record<string, Json>) =>
  Object.entries(v.when ?? {}).every(([k, allowed]) => allowed.some((a) => JSON.stringify(a) === JSON.stringify(values[k])))

export function TemplatesGallery({ status, onCreate }: {
  status: ExperimentsStatus | null
  onCreate: (d: Descriptor, note: string, valid: boolean) => void
}) {
  const { t: translateText } = useI18n()

  const [templates, setTemplates] = useState<TemplateInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, Json>>({})
  const [problems, setProblems] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    getTemplates().then((r) => alive && setTemplates(r.templates)).catch((e) => alive && setError(`Não foi possível listar os modelos: ${(e as Error).message}`))
    return () => { alive = false }
  }, [])
  const t = templates.find((x) => x.id === sel) ?? null
  const defaults = useMemo(() => status?.defaults ?? {}, [status])

  function choose(id: string) {
    const tpl = templates.find((x) => x.id === id)!
    setSel(id); setValues(initial(tpl, defaults)); setProblems({}); setError(null)
  }
  async function create() {
    if (!t) return
    setBusy(true); setProblems({}); setError(null)
    try {
      const r = await renderTemplate(t.id, values)
      onCreate(r.descriptor, `Criado a partir de “${t.title}”.${r.valid ? "" : " Há ajustes a fazer: veja a aba Plano."}`, r.valid)
    } catch (e) {
      const err = e as ApiError
      const list = (err.body as { problems?: { variable: string; message: string }[] }).problems
      if (list) setProblems(Object.fromEntries(list.map((p) => [p.variable, p.message])))
      else setError(err.message)
    } finally { setBusy(false) }
  }
  const set = (name: string, v: Json | undefined) => setValues((cur) => { const n = { ...cur }; if (v === undefined || v === "") delete n[name]; else n[name] = v; return n })

  function control(v: TemplateVar) {
    const id = `tv-${v.name}`
    const val = values[v.name]
    switch (v.kind) {
      case "choice":
        return (
          <select id={id} className={INPUT} value={val === undefined ? "" : JSON.stringify(val)} onChange={(e) => set(v.name, e.target.value ? (JSON.parse(e.target.value) as Json) : undefined)}>
            <option value="">{translateText("escolher…")}</option>
            {v.choices?.map((c, i) => <option key={i} value={JSON.stringify(c.value)}>{translateText(c.label)}</option>)}
          </select>
        )
      case "scenario": return <ScenarioPicker id={id} value={String(val ?? "")} onChange={(x) => set(v.name, x)} />
      case "clickhouse": return <LocationPicker id={id} kind="clickhouse" value={String(val ?? "")} onChange={(x) => set(v.name, x)} />
      case "dir": case "path": case "file":
        return <PathInput id={id} dir={v.kind === "dir"} value={String(val ?? "")} placeholder={translateText(v.example)} onChange={(x) => set(v.name, x)} />
      case "number":
        return <input id={id} className={INPUT} type="number" value={typeof val === "number" ? val : ""} onChange={(e) => set(v.name, e.target.value === "" ? undefined : Number(e.target.value))} />
      default:
        return <input id={id} className={INPUT} placeholder={translateText(v.example)} value={val === undefined ? "" : String(val)} onChange={(e) => set(v.name, e.target.value)} />
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">{translateText("Escolha um ponto de partida. Você responde algumas perguntas e recebe um descritor completo, que continua editável.")}</p>
        {error && !t && <p className="text-xs text-destructive" role="alert">{translateText(error)}</p>}
        <ul className="flex flex-col gap-2" aria-label={translateText("Modelos de experimento")}>
          {templates.map((x) => (
            <li key={x.id}>
              <button type="button" aria-current={x.id === sel} onClick={() => choose(x.id)}
                className={`flex w-full flex-col gap-1 rounded-sm border px-3 py-2 text-left ${x.id === sel ? "border-primary bg-primary/10" : "border-border hover:bg-muted/40"}`}>
                <span className="flex items-start justify-between gap-2"><span className="text-xs font-semibold">{translateText(x.title)}</span>
                  <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] ${TAG[x.verified].cls}`} title={translateText(TAG[x.verified].help)}>{translateText(TAG[x.verified].text)}</span></span>
                <span className="text-[11px] text-muted-foreground">{translateText(x.summary)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {t ? (
        <div className="flex max-w-3xl flex-col gap-4">
          <div>
            <h2 className="text-sm font-semibold">{translateText(t.title)}</h2>
            <p className="mt-1 text-xs">{translateText(t.summary)}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <section><h3 className="mb-1 text-[11px] font-semibold text-muted-foreground">{translateText("QUANDO USAR")}</h3><ul className="list-disc pl-4 text-xs">{t.when.map((w, i) => <li key={i}>{translateText(w)}</li>)}</ul></section>
            <section><h3 className="mb-1 text-[11px] font-semibold text-muted-foreground">{translateText("VOCÊ PRECISA TER")}</h3><ul className="list-disc pl-4 text-xs">{t.needs.map((w, i) => <li key={i}>{translateText(w)}</li>)}</ul></section>
          </div>
          <p className={`rounded-sm border px-3 py-2 text-xs ${t.verified === "verificado" ? "border-green-500/40" : t.verified === "parcial" ? "border-amber-500/50 bg-amber-500/5" : "border-destructive/40 bg-destructive/5"}`}>
            <b>{translateText("Estado de verificação — ")}{translateText(TAG[t.verified].text)}.</b> {translateText(t.verified_note)}
          </p>
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); create() }} aria-label={translateText("Perguntas do modelo")}>
            <h3 className="text-xs font-semibold">{translateText("Perguntas")}</h3>
            {t.variables.filter((v) => visible(v, values)).map((v) => (
              <div key={v.name} className="flex flex-col gap-1">
                <label htmlFor={`tv-${v.name}`} className={LABEL}>{translateText(v.label)}{v.required && <span className="text-destructive"> *</span>}</label>
                {translateText(control(v))}
                <p className="text-[11px] leading-snug text-muted-foreground">{translateText(v.help)}</p>
                {v.kind === "choice" && values[v.name] !== undefined && <p className="text-[11px] text-muted-foreground">{translateText(v.choices?.find((c) => JSON.stringify(c.value) === JSON.stringify(values[v.name]))?.help)}</p>}
                {problems[v.name] && <p className="text-[11px] text-destructive" role="alert">{translateText(problems[v.name])}</p>}
              </div>
            ))}
            {error && <p className="text-xs text-destructive" role="alert">{translateText(error)}</p>}
            <div><Button type="submit" disabled={busy}>{busy ? translateText("Criando…") : translateText("Criar descritor")}</Button></div>
          </form>
        </div>
      ) : <p className="text-xs text-muted-foreground">{translateText("Escolha um modelo à esquerda.")}</p>}
    </div>
  )
}
