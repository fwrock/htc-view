"use client"

import { useEffect, useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { useI18n } from "@/components/i18n-provider"
import { getRun, type RunStatus } from "@/lib/simedape-api"

/** Durable job logs include stage boundaries, phase progress and failures. */
export function RunLogs({ runId, status }: { runId: string; status: RunStatus }) {
  const { t } = useI18n()
  const [result, setResult] = useState<{ id: string; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    setError(null)
    const active = status === "running" || status === "queued"
    const load = async () => {
      try {
        const run = await getRun(runId)
        if (!cancelled) {
          setResult({ id: runId, text: run.logs ?? "" })
          setError(null)
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (!cancelled && active) timer = setTimeout(load, 3000)
      }
    }
    void load()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [runId, status, refresh])
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium">{t("Logs das fases")}</p>
        <Button size="xs" variant="outline" onClick={() => setRefresh(value => value + 1)}>{t("Atualizar")}</Button>
      </div>
      {(status === "running" || status === "queued") && <p className="text-[11px] text-muted-foreground">{t("Atualização automática a cada 3 segundos.")}</p>}
      {error && <p role="alert" className="text-[11px] text-destructive">{t("Falha ao carregar logs: {0}", { 0: error })}</p>}
      <pre aria-label={t("Logs das fases")} className="max-h-96 overflow-auto whitespace-pre-wrap rounded-sm bg-muted/40 p-3 font-mono text-[10px]">{result?.id === runId ? result.text || t("Nenhum log disponível.") : t("Carregando logs…")}</pre>
    </div>
  )
}
