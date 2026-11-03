"use client"

import { useI18n } from "@/components/i18n-provider"

import { useCallback, useEffect, useState } from "react"
import { ArrowDown, ArrowUp } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { listModificationFiles, validateModificationFiles, type ModificationsFilesReport } from "@/lib/simedape-api"

/** Choose which modification files of a scenario apply to a run, and in which order. Validates the chosen list as a whole. */
export function ModificationPicker({ scenarioRef, value, onChange, compact, refreshKey }: { scenarioRef: string; value: string[]; onChange: (files: string[]) => void; compact?: boolean; refreshKey?: number }) {
  const { t: translateText } = useI18n()

  const [files, setFiles] = useState<string[]>([])
  const [report, setReport] = useState<ModificationsFilesReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [listError, setListError] = useState<string | null>(null)
  const load = useCallback(() => {
    if (!scenarioRef) {
      setFiles([])
      return
    }
    listModificationFiles(scenarioRef).then((r) => { setFiles(r.files); setListError(null) }).catch((e) => { setFiles([]); setListError((e as Error).message) })
  }, [scenarioRef])
  useEffect(load, [load, refreshKey])
  // files are often created in another tab (the Modificações page): refresh when coming back
  useEffect(() => {
    window.addEventListener("focus", load)
    return () => window.removeEventListener("focus", load)
  }, [load])

  // drop selected names that no longer exist in the folder
  useEffect(() => {
    if (files.length && value.some((v) => !files.includes(v))) onChange(value.filter((v) => files.includes(v)))
  }, [files, value, onChange])

  useEffect(() => {
    if (!scenarioRef || value.length === 0) {
      setReport(null)
      setError(null)
      return
    }
    let cancelled = false
    validateModificationFiles(scenarioRef, value)
      .then((r) => !cancelled && (setReport(r), setError(null)))
      .catch((e) => !cancelled && (setReport(null), setError((e as Error).message)))
    return () => {
      cancelled = true
    }
  }, [scenarioRef, value])

  const move = (i: number, d: -1 | 1) => {
    const next = [...value]
    const k = i + d
    if (k < 0 || k >= next.length) return
    ;[next[i], next[k]] = [next[k]!, next[i]!]
    onChange(next)
  }
  const unselected = files.filter((f) => !value.includes(f))

  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <span className="font-medium">{translateText("Modificações (opcional)")}{value.length > 0 ? translateText(" · {0} em ordem", { 0: value.length }) : translateText("")}</span>
      {!scenarioRef && <span className="text-[11px] text-muted-foreground">{translateText("Escolha o cenário base para ver os arquivos dele.")}</span>}
      {scenarioRef && files.length === 0 && (
        <span className="text-[11px] text-muted-foreground">
          {listError ? `Não foi possível listar: ${listError}` : <>{translateText("Este cenário ainda não tem arquivos em ")}<code className="font-mono">modifications/</code>. </>}{translateText("Crie um em ")}<a className="underline" target="_blank" rel="noreferrer" href={`/modifications?ref=${encodeURIComponent(scenarioRef)}`}>{translateText("Modificações")}</a>{translateText(" (abre noutra aba; a lista atualiza ao voltar)")}<button type="button" className="ml-2 underline" onClick={load}>{translateText("atualizar")}</button>
        </span>
      )}
      {scenarioRef && files.length > 0 && <button type="button" className="self-start text-[11px] text-muted-foreground underline" onClick={load}>{translateText("atualizar lista")}</button>}
      <ul className="flex flex-col gap-1">
        {value.map((name, i) => (
          <li key={name} className="flex items-center gap-2 rounded-sm border border-primary/30 bg-primary/5 px-2 py-1">
            <input type="checkbox" checked onChange={() => onChange(value.filter((v) => v !== name))} />
            <span className="font-mono text-[11px]">{translateText(i + 1)}. {translateText(name)}</span>
            <span className="ml-auto flex gap-1">
              <button type="button" aria-label={translateText("Subir")} className="rounded-sm p-0.5 hover:bg-muted" onClick={() => move(i, -1)}><ArrowUp className="size-3" /></button>
              <button type="button" aria-label={translateText("Descer")} className="rounded-sm p-0.5 hover:bg-muted" onClick={() => move(i, 1)}><ArrowDown className="size-3" /></button>
            </span>
          </li>
        ))}
        {unselected.map((name) => (
          <li key={name} className="flex items-center gap-2 px-2 py-0.5">
            <input type="checkbox" checked={false} onChange={() => onChange([...value, name])} />
            <span className="font-mono text-[11px] text-muted-foreground">{translateText(name)}</span>
          </li>
        ))}
      </ul>
      {error && <p className="text-[11px] text-destructive">{translateText(error)}</p>}
      {report && (
        <p className={cn("text-[11px]", report.ok ? "text-green-700 dark:text-green-400" : "text-destructive")}>
          {report.ok ? translateText("Válidas em conjunto: {0} operação(ões), +{1} −{2}.", { 0: report.summary.operations, 1: report.summary.added, 2: report.summary.removed }) : translateText("{0} erro(s): {1}", { 0: report.errors.length, 1: report.errors.slice(0, compact ? 1 : 3).join(" · ") })}
          {report.ok && report.warnings.length > 0 && <span className="text-yellow-700 dark:text-yellow-400"> {translateText(report.warnings.length)}{translateText(" aviso(s): ")}{translateText(report.warnings[0])}</span>}
        </p>
      )}
    </div>
  )
}
