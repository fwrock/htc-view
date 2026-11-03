"use client"

import { useI18n } from "@/components/i18n-provider"

import { useCallback, useEffect, useRef, useState } from "react"
import { Download, Save, Upload } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { DescriptorEditor } from "@/components/experiment/descriptor-editor"
import { INPUT, LABEL } from "@/components/experiment/fields"
import { PlanView } from "@/components/experiment/plan-view"
import { TemplatesGallery } from "@/components/experiment/templates-gallery"
import { RunsPanel } from "@/components/experiment/runs-panel"
import {
  ApiError, NEW_DESCRIPTOR, getExamples, getExperimentSchema, getExperimentsStatus, getSavedDescriptor, listSavedDescriptors,
  saveDescriptor, startExperiment, validateDescriptor,
  type Descriptor, type ExperimentSchema, type ExperimentsStatus, type StartOptions, type ValidateResult,
} from "@/lib/experiment-api"

type Tab = "start" | "descriptor" | "plan" | "runs"
const TABS: { id: Tab; label: string }[] = [
  { id: "start", label: "Começar por um modelo" },
  { id: "descriptor", label: "Descritor" },
  { id: "plan", label: "Plano e execução" },
  { id: "runs", label: "Execuções" },
]
const DRAFT = "htc.experiment.draft.v1"

function loadDraft(): Descriptor {
  try {
    const raw = window.localStorage.getItem(DRAFT)
    if (raw) return JSON.parse(raw) as Descriptor
  } catch { /* private window or corrupt draft */ }
  return NEW_DESCRIPTOR
}

export default function ExperimentPage() {
  const { t: translateText } = useI18n()

  const [tab, setTab] = useState<Tab>("start")
  const [descriptor, setDescriptor] = useState<Descriptor>(NEW_DESCRIPTOR)
  const [ready, setReady] = useState(false)
  const [schema, setSchema] = useState<ExperimentSchema | null>(null)
  const [status, setStatus] = useState<ExperimentsStatus | null>(null)
  const [result, setResult] = useState<ValidateResult | null>(null)
  const [validating, setValidating] = useState(false)
  const [sets, setSets] = useState("")
  const [apiError, setApiError] = useState<string | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [selectedRun, setSelectedRun] = useState<string | null>(null)
  const [examples, setExamples] = useState<{ name: string; description: string; descriptor: Descriptor }[]>([])
  const [saved, setSaved] = useState<{ name: string }[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    const t = setTimeout(() => { setDescriptor(loadDraft()); setReady(true) }, 0)
    return () => clearTimeout(t)
  }, [])
  const refreshLibrary = useCallback(() => {
    listSavedDescriptors().then((r) => setSaved(r.descriptors)).catch(() => {})
  }, [])
  useEffect(() => {
    const t = setTimeout(() => {
      getExperimentsStatus().then(setStatus).catch((e) => setApiError(`API de experimentos indisponível: ${(e as Error).message}`))
      getExperimentSchema().then(setSchema).catch(() => {})
      getExamples().then((r) => setExamples(r.examples)).catch(() => {})
      refreshLibrary()
    }, 0)
    return () => clearTimeout(t)
  }, [refreshLibrary])

  const setLines = sets.split("\n").map((s) => s.trim()).filter(Boolean)
  useEffect(() => {
    if (!ready) return
    try { window.localStorage.setItem(DRAFT, JSON.stringify(descriptor)) } catch { /* storage unavailable */ }
    const mine = ++seq.current
    const t = setTimeout(async () => {
      setValidating(true)
      try {
        const r = await validateDescriptor(descriptor, setLines)
        if (mine === seq.current) { setResult(r); setApiError(null) }
      } catch (e) {
        if (mine === seq.current) setApiError(`Não foi possível validar: ${(e as Error).message}`)
      } finally {
        if (mine === seq.current) setValidating(false)
      }
    }, 450)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [descriptor, sets, ready])

  async function run(opts: Pick<StartOptions, "confirm_billable" | "force" | "keep_env" | "only">) {
    setStarting(true); setRunError(null)
    try {
      const r = await startExperiment(descriptor, { ...opts, sets: setLines, only: opts.only?.length ? opts.only : undefined })
      setSelectedRun(r.id); setTab("runs")
    } catch (e) {
      const err = e as ApiError
      setRunError(err.body?.problems ? `${err.message}: ${err.body.problems.map((p) => `${p.path} ${p.message}`).join("; ")}` : err.message)
    } finally { setStarting(false) }
  }
  async function save() {
    try { await saveDescriptor(descriptor.name, descriptor); setMessage(`Salvo como “${descriptor.name}”.`); refreshLibrary() }
    catch (e) { setMessage(`Não foi possível salvar: ${(e as Error).message}`) }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(descriptor, null, 2)], { type: "application/json" }))
    const a = document.createElement("a")
    a.href = url; a.download = `${descriptor.name || "experimento"}.json`; a.click()
    URL.revokeObjectURL(url)
  }
  async function upload(file: File | undefined) {
    if (!file) return
    try { setDescriptor(JSON.parse(await file.text()) as Descriptor); setMessage(`Carregado: ${file.name}`) }
    catch { setMessage("O arquivo não é um JSON válido.") }
  }
  const problems = result && !result.valid ? result.problems : []

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <div>
        <h1 className="font-serif text-xl">{translateText("Experimento")}</h1>
        <p className="text-xs text-muted-foreground">{translateText("Descreva o experimento inteiro — ambiente (local, docker, vm, gke), treino, seleção, simulações, estimativa e relatório — num arquivo. A CLI ")}<span className="font-mono">{translateText("htc-experiment")}</span>{translateText(" executa o mesmo descritor em qualquer ambiente.")}</p>
      </div>
      {apiError && <p className="rounded-sm border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive" role="alert">{translateText(apiError)}</p>}

      <div className="flex flex-wrap items-end gap-3 rounded-sm border border-border p-3">
        <label className="flex flex-col gap-1"><span className={LABEL}>{translateText("Começar de um exemplo")}</span>
          <select className={`${INPUT} w-56`} value="" onChange={(e) => { const ex = examples.find((x) => x.name === e.target.value); if (ex) { setDescriptor(ex.descriptor); setMessage(`Exemplo “${ex.name}” carregado.`) } }}>
            <option value="">{translateText("escolher…")}</option>{examples.map((x) => <option key={x.name} value={x.name}>{translateText(x.name)}</option>)}</select></label>
        <label className="flex flex-col gap-1"><span className={LABEL}>{translateText("Meus descritores")}</span>
          <select className={`${INPUT} w-56`} value="" onChange={(e) => { if (e.target.value) getSavedDescriptor(e.target.value).then((r) => { setDescriptor(r.descriptor); setMessage(`“${e.target.value}” carregado.`) }).catch((er) => setMessage((er as Error).message)) }}>
            <option value="">{translateText("escolher…")}</option>{saved.map((x) => <option key={x.name} value={x.name}>{translateText(x.name)}</option>)}</select></label>
        <Button type="button" size="sm" variant="outline" onClick={save}><Save className="size-3.5" />{translateText(" Salvar no servidor")}</Button>
        <Button type="button" size="sm" variant="outline" onClick={download}><Download className="size-3.5" />{translateText(" Baixar .json")}</Button>
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm border border-border px-2.5 py-1.5 text-xs hover:bg-muted/50"><Upload className="size-3.5" />{translateText(" Abrir .json")}<input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = "" }} /></label>
        <Button type="button" size="sm" variant="ghost" onClick={() => { setDescriptor(NEW_DESCRIPTOR); setSets(""); setMessage("Novo descritor.") }}>{translateText("Novo")}</Button>
        {message && <span className="text-[11px] text-muted-foreground" role="status">{translateText(message)}</span>}
      </div>

      <nav className="flex gap-2 border-b pb-2" aria-label={translateText("Etapas do experimento")}>
        {TABS.map((t) => (
          <button key={t.id} type="button" aria-pressed={tab === t.id} onClick={() => setTab(t.id)}
            className={`rounded-sm border px-3 py-2 text-xs ${tab === t.id ? "border-primary bg-primary/10" : "border-border"}`}>
            {translateText(t.label)}{t.id === "plan" && result && (result.valid ? <span className="ml-1.5 text-green-600 dark:text-green-400">✓</span> : <span className="ml-1.5 rounded-sm bg-destructive/15 px-1 text-[10px] text-destructive">{translateText(problems.length)}</span>)}
          </button>
        ))}
      </nav>

      <div hidden={tab !== "start"}>
        <TemplatesGallery status={status} onCreate={(d, note, valid) => { setDescriptor(d); setSets(""); setMessage(note); setTab(valid ? "plan" : "descriptor") }} />
      </div>
      <div hidden={tab !== "descriptor"}><DescriptorEditor descriptor={descriptor} onChange={setDescriptor} schema={schema} problems={problems} /></div>
      <div hidden={tab !== "plan"}>
        <PlanView result={result} validating={validating} status={status} sets={sets} onSets={setSets} onRun={run} starting={starting} error={runError} />
      </div>
      <div hidden={tab !== "runs"}><RunsPanel selected={selectedRun} onSelect={setSelectedRun} /></div>
    </div>
  )
}
