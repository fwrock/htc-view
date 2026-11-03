"use client"

import { useI18n } from "@/components/i18n-provider"

import { useCallback, useEffect, useRef, useState } from "react"
import { Pause, Play, Square } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import {
  getSimulationStatus,
  pauseSimulation,
  resumeSimulation,
  setHtcApiBase,
  stopSimulation,
  type SimulationStatus,
  type StatusResponse,
} from "@/lib/htc-api"

const TONE: Record<SimulationStatus, string> = {
  Idle: "bg-muted text-muted-foreground border-border",
  Loading: "bg-chart-1/20 text-chart-2 border-chart-1/30",
  Running: "bg-green-500/10 text-green-600 border-green-500/30 dark:text-green-400",
  Paused: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30 dark:text-yellow-400",
  Stopped: "bg-destructive/10 text-destructive border-destructive/30",
  Failed: "bg-destructive/10 text-destructive border-destructive/30",
  Resetting: "bg-chart-1/20 text-chart-2 border-chart-1/30",
}

/** Status, progress and controls of the simulation running on an engine. Embeddable (SimEDaPE) and standalone-friendly:
 *  it only needs the engine URL, the same one the Simulator page uses. `partial` shows the PARCIAL badge. */
export function RunMonitor({ engineUrl, partial, altered, onStatus }: { engineUrl: string; partial?: string | null; altered?: string | null; onStatus?: (s: StatusResponse) => void }) {
  const { t: translateText } = useI18n()

  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const onStatusRef = useRef(onStatus)
  onStatusRef.current = onStatus
  const pending = useRef(false)
  const refresh = useCallback(async () => {
    if (pending.current) return
    pending.current = true
    setHtcApiBase(engineUrl) // the htc-api client talks to one engine at a time, chosen here
    try {
      const s = await getSimulationStatus()
      setStatus(s)
      setError(null)
      onStatusRef.current?.(s)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      pending.current = false
    }
  }, [engineUrl])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void refresh()
    }, status?.status === "Running" || status?.status === "Loading" ? 2000 : 10000)
    return () => clearInterval(t)
  }, [refresh, status?.status])

  async function act(name: string, fn: () => Promise<unknown>) {
    setBusy(name)
    try {
      setHtcApiBase(engineUrl)
      await fn()
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const st = status?.status ?? "Idle"
  const pct = Math.min(100, Math.max(0, (status?.progressRatio ?? 0) * 100))
  return (
    <div className="flex flex-col gap-2 rounded-sm border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("inline-flex items-center rounded-sm border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-widest", TONE[st])}>{translateText(st)}</span>
        {altered && <span className="rounded-sm border border-yellow-500/50 bg-yellow-500/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-widest text-yellow-700 dark:text-yellow-400" title={translateText("Modificações aplicadas, em ordem")}>{translateText("Alterada · ")}{translateText(altered)}</span>}
        {partial && <span className="rounded-sm border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-widest text-primary">{translateText("Parcial · ")}{translateText(partial)}</span>}
        <span className="font-mono text-[11px] text-muted-foreground">{translateText("tick ")}{translateText(status?.currentTick ?? 0)} · {translateText(pct.toFixed(1))}%</span>
        <span className="ml-auto flex gap-1">
          <Button size="sm" variant="outline" disabled={st !== "Running" || busy !== null} onClick={() => void act("pause", pauseSimulation)}><Pause className="size-3.5" /></Button>
          <Button size="sm" variant="outline" disabled={st !== "Paused" || busy !== null} onClick={() => void act("resume", resumeSimulation)}><Play className="size-3.5" /></Button>
          <Button size="sm" variant="outline" disabled={(st !== "Running" && st !== "Paused") || busy !== null} onClick={() => void act("stop", stopSimulation)}><Square className="size-3.5" /></Button>
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} /></div>
      {error && <p className="text-[11px] text-destructive">{translateText(error)}</p>}
      <a href="/simulator" className="self-start text-[11px] text-muted-foreground underline hover:text-foreground">{translateText("Abrir no Simulator (configurações, logs e métricas)")}</a>
    </div>
  )
}
