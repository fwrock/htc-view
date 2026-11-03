"use client"

import { useI18n } from "@/components/i18n-provider"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Map } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { NativeHTCResults, NativeHTCStart } from "@/components/htc-runs/native-htc"
import {
  getRun,
  listRuns,
  nativeArtifactUrl,
  type NativeResults,
  type RunStatus,
  type RunSummary,
} from "@/lib/simedape-api"

const badge: Record<RunStatus, string> = {
  queued: "border-border bg-muted text-muted-foreground",
  running: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  completed: "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400",
  failed: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
  cancelled: "border-border bg-muted text-muted-foreground",
}
const label: Record<RunStatus, string> = {
  queued: "Na fila",
  running: "Em execução",
  completed: "Concluído",
  failed: "Falhou",
  cancelled: "Cancelado",
}
const fmt = (ts: number | null, intlLocale: string) => (ts ? new Date(ts * 1000).toLocaleString(intlLocale) : "—")

export default function HtcRunsPage() {
  const { t: translateText, intlLocale } = useI18n()

  const [runs, setRuns] = useState<RunSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<RunSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (select?: string) => {
    try {
      const list = (await listRuns())
        .filter((r) => r.meta.workflow === "htc_native")
        .sort((a, b) => b.created_at - a.created_at)
      setRuns(list)
      const requestedRun = new URLSearchParams(window.location.search).get("run")
      setSelectedId((cur) => select ?? (cur && list.some((r) => r.run_id === cur) ? cur :
        requestedRun && list.some((r) => r.run_id === requestedRun) ? requestedRun : (list[0]?.run_id ?? null)))
      setError(null)
    } catch (e) {
      setError(`Não foi possível contatar a API de jobs (${(e as Error).message}).`)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 4000)
    return () => clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    if (!selectedId) return
    let active = true
    getRun(selectedId)
      .then((r) => active && setDetail(r))
      .catch(() => active && setDetail(null))
    return () => {
      active = false
    }
  }, [selectedId, runs])

  const selected = detail && detail.run_id === selectedId ? detail : null
  const results = selected?.result?.native_results as unknown as NativeResults | undefined

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
      <div>
        <h1 className="font-heading text-lg font-semibold">{translateText("HTC · Execuções")}</h1>
        <p className="text-xs text-muted-foreground">{translateText("Execute o simulador HTC sobre um cenário dos seus locais, revise os resultados e abra o replay.")}{" "}
          <Link href="/locations" className="text-primary underline">{translateText("Configurar locais")}</Link>
          {" · "}<Link href="/simulator/import" className="text-primary underline">{translateText("Preparar cenário: HTC ou OSM")}</Link>
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-sm border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
          {translateText(error)}
        </p>
      )}

      <NativeHTCStart onStarted={(id) => void refresh(id)} />

      <section className="rounded-sm border border-border bg-card" aria-label={translateText("Execuções")}>
        {runs.length === 0 ? (
          <p className="p-4 text-xs text-muted-foreground">{translateText("Nenhuma execução ainda.")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {runs.map((r) => (
              <li key={r.run_id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(r.run_id)}
                  className={cn(
                    "flex w-full flex-wrap items-center gap-3 px-4 py-2.5 text-left text-xs hover:bg-muted/40",
                    r.run_id === selectedId && "bg-muted/60"
                  )}
                >
                  <span className={cn("rounded-sm border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest", badge[r.status])}>
                    {translateText(label[r.status])}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{translateText(r.name)}</span>
                  <span className="text-muted-foreground">{translateText(fmt(r.created_at, intlLocale))}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected && (
        <section className="flex flex-col gap-3 rounded-sm border border-border bg-card p-4" aria-label={translateText("Detalhes da execução")}>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-semibold">{translateText(selected.name)}</h2>
            <span className={cn("rounded-sm border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest", badge[selected.status])}>
              {translateText(label[selected.status])}
            </span>
            {!!selected.meta.native_live && <Link href={`/simulator/live?run=${selected.run_id}`} className="text-xs text-primary underline">{translateText("Abrir ao vivo deste run")}</Link>}
            {selected.status === "completed" && (
              <Link href={`/simulator/replay?scenario=simedape-${selected.run_id}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                <Map className="size-3" />{translateText(" Abrir replay")}</Link>
            )}
            <a className="text-xs text-primary underline" href={nativeArtifactUrl(selected.run_id, "engine.log")}>{translateText("engine.log")}</a>
            <Button size="sm" variant="ghost" onClick={() => void refresh()}>{translateText("Atualizar")}</Button>
          </div>
          <p className="text-[11px] text-muted-foreground">{translateText("Cenário: ")}{translateText(selected.meta.scenario_name ?? "—")}{translateText(" · iniciado ")}{translateText(fmt(selected.started_at, intlLocale))}{translateText(" · concluído ")}{translateText(fmt(selected.finished_at, intlLocale))}
          </p>
          {selected.error && <p className="text-xs text-destructive">{translateText("Erro: ")}{translateText(selected.error)}</p>}
          {selected.status === "completed" && results && (
            <NativeHTCResults key={selected.run_id} runId={selected.run_id} result={results} />
          )}
        </section>
      )}
    </div>
  )
}

