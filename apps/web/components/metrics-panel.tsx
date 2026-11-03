"use client"

import { useI18n } from "@/components/i18n-provider"

import { useCallback, useEffect, useRef, useState } from "react"
import { Activity, AlertCircle, Loader2, RotateCcw } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HtcMetrics {
  // Simulation progress
  currentTick: number | null
  progressRatio: number | null
  ticksTotal: number | null
  tickDurationAvgMs: number | null
  // Actors
  activeActors: Record<string, number>
  actorsRegistered: Record<string, number>
  // Events
  eventsProcessed: Record<string, number>
  // Time manager
  tmScheduledActors: number | null
  tmRunningEvents: number | null
  tmWaitingForProgressive: number | null
  // Progressive loading
  progressiveActorsCreated: number | null
  progressiveLoadedUpToTick: number | null
  progressiveWindowsLoaded: number | null
  // Journeys
  journeysStarted: Record<string, number>
  journeysCompleted: Record<string, number>
  // Infrastructure
  deadLetters: number | null
  kafkaMessages: Record<string, number>
  // JVM Memory
  jvmHeapUsed: number | null
  jvmHeapMax: number | null
  jvmHeapCommitted: number | null
  jvmNonHeapUsed: number | null
  jvmNonHeapMax: number | null
  jvmMemoryPoolsUsed: Record<string, number>
  jvmMemoryPoolsMax: Record<string, number>
  // JVM GC
  gcPauseSecs: Record<string, number>
  gcCount: Record<string, number>
  // JVM Threads
  jvmThreadsCurrent: number | null
  jvmThreadsDaemon: number | null
  jvmThreadsPeak: number | null
  jvmThreadsDeadlocked: number | null
  jvmThreadsState: Record<string, number>
  // Process
  processCpuSecondsTotal: number | null
  processOpenFds: number | null
  processMaxFds: number | null
  processResidentBytes: number | null
}

// ---------------------------------------------------------------------------
// Sparkline (SVG, no deps)
// ---------------------------------------------------------------------------

function Sparkline({
  data,
  className,
  color = "var(--color-primary)",
}: {
  data: number[]
  className?: string
  color?: string
}) {
  if (data.length < 2) return <div className={cn("h-8", className)} />
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const W = 120
  const H = 28
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * W
      const y = H - ((v - min) / range) * (H - 4) - 2
      return `${x},${y}`
    })
    .join(" ")
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={cn("w-full", className)}
      style={{ height: H }}
      preserveAspectRatio="none"
    >
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.75"
      />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

function SectionHeader({ label }: { label: string }) {
  const { t: translateText } = useI18n()

  return (
    <div className="flex items-center gap-2 pt-1">
      <p className="whitespace-nowrap text-[9px] font-semibold tracking-widest text-muted-foreground uppercase">
        {translateText(label)}
      </p>
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Small metric card
// ---------------------------------------------------------------------------

function MetricCard({
  label,
  value,
  sub,
  history,
  highlight,
}: {
  label: string
  value: string
  sub?: string
  history?: number[]
  highlight?: "warn" | "error" | "ok"
}) {
  const { t: translateText } = useI18n()

  const borderClass =
    highlight === "error"
      ? "border-destructive/40"
      : highlight === "warn"
        ? "border-yellow-500/40"
        : highlight === "ok"
          ? "border-green-500/30"
          : "border-border"

  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-sm border bg-card p-3",
        borderClass
      )}
    >
      <p className="text-[9px] font-semibold tracking-widest text-muted-foreground uppercase">
        {translateText(label)}
      </p>
      <p className="font-mono text-base font-semibold tabular-nums leading-none text-foreground">
        {translateText(value)}
      </p>
      {sub && <p className="text-[10px] text-muted-foreground">{translateText(sub)}</p>}
      {history && history.length > 1 && (
        <Sparkline data={history} className="mt-1 opacity-70" />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Labelled bar chart
// ---------------------------------------------------------------------------

function LabelledBars({
  data,
  label,
  colorClass = "bg-primary",
  maxLabel = 24,
}: {
  data: Record<string, number>
  label: string
  colorClass?: string
  maxLabel?: number
}) {
  const { t: translateText, intlLocale } = useI18n()

  const entries = Object.entries(data).sort((a, b) => b[1] - a[1])
  if (entries.length === 0)
    return (
      <p className="text-[11px] text-muted-foreground">{translateText("Sem dados ainda…")}</p>
    )
  const max = Math.max(...entries.map((e) => e[1]), 1)

  return (
    <div className="flex flex-col gap-0.5">
      <p className="mb-1 text-[9px] font-semibold tracking-widest text-muted-foreground uppercase">
        {translateText(label)}
      </p>
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center gap-2">
          <span
            className="shrink-0 truncate text-right font-mono text-[10px] text-muted-foreground"
            style={{ width: `${maxLabel * 6}px` }}
          >
            {translateText(k)}
          </span>
          <div className="flex flex-1 items-center gap-1.5">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-300",
                  colorClass
                )}
                style={{ width: `${(v / max) * 100}%` }}
              />
            </div>
            <span className="w-16 font-mono text-[10px] tabular-nums text-foreground">
              {translateText(v.toLocaleString(intlLocale))}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// GC table
// ---------------------------------------------------------------------------

function GcTable({
  pauseSecs,
  count,
}: {
  pauseSecs: Record<string, number>
  count: Record<string, number>
}) {
  const { t: translateText, intlLocale } = useI18n()

  const collectors = [
    ...new Set([...Object.keys(pauseSecs), ...Object.keys(count)]),
  ].sort()
  if (collectors.length === 0) return null

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-border text-left text-[10px] text-muted-foreground">
          <th className="pb-1.5 pr-3 font-medium">{translateText("Coletor")}</th>
          <th className="pb-1.5 pr-3 text-right font-medium">{translateText("Coletas")}</th>
          <th className="pb-1.5 pr-3 text-right font-medium">{translateText("Pausa total")}</th>
          <th className="pb-1.5 text-right font-medium">{translateText("Média")}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {collectors.map((gc) => {
          const n = count[gc] ?? 0
          const s = pauseSecs[gc] ?? 0
          const avg = n > 0 ? (s / n) * 1000 : 0
          return (
            <tr key={gc}>
              <td className="py-1.5 pr-3 font-mono text-[10px]">{translateText(gc)}</td>
              <td className="py-1.5 pr-3 text-right font-mono text-[10px] tabular-nums">
                {translateText(n.toLocaleString(intlLocale))}
              </td>
              <td className="py-1.5 pr-3 text-right font-mono text-[10px] tabular-nums">
                {translateText(s.toFixed(3))}{translateText(" s")}</td>
              <td className="py-1.5 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
                {translateText(avg.toFixed(1))}{translateText(" ms")}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ---------------------------------------------------------------------------
// Memory pool bars
// ---------------------------------------------------------------------------

function MemoryPoolBars({
  used,
  max,
}: {
  used: Record<string, number>
  max: Record<string, number>
}) {
  const { t: translateText } = useI18n()

  const pools = Object.keys(used).sort()
  if (pools.length === 0) return null

  return (
    <div className="flex flex-col gap-1">
      {pools.map((pool) => {
        const u = used[pool] ?? 0
        const m = max[pool] ?? 0
        const pct = m > 0 ? (u / m) * 100 : 0
        const usedMb = (u / 1024 / 1024).toFixed(0)
        const maxMb = m > 0 ? `${(m / 1024 / 1024).toFixed(0)} MB` : "∞"
        const barClass =
          pct > 90
            ? "bg-destructive"
            : pct > 75
              ? "bg-yellow-500"
              : "bg-primary"
        return (
          <div key={pool} className="flex items-center gap-2">
            <span className="w-40 shrink-0 truncate text-right font-mono text-[9px] text-muted-foreground">
              {translateText(pool)}
            </span>
            <div className="flex flex-1 items-center gap-1.5">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-300",
                    barClass
                  )}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>
              <span className="w-24 text-right font-mono text-[9px] tabular-nums text-foreground">
                {translateText(usedMb)} / {translateText(maxMb)}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Thread state color map
const THREAD_STATE_COLORS: Record<string, string> = {
  RUNNABLE: "bg-green-500",
  WAITING: "bg-yellow-500",
  TIMED_WAITING: "bg-blue-500",
  BLOCKED: "bg-destructive",
  NEW: "bg-muted-foreground",
  TERMINATED: "bg-muted-foreground",
}

// ---------------------------------------------------------------------------
// Journey comparison table
// ---------------------------------------------------------------------------

function JourneyTable({
  started,
  completed,
}: {
  started: Record<string, number>
  completed: Record<string, number>
}) {
  const { t: translateText, intlLocale } = useI18n()

  const types = [
    ...new Set([...Object.keys(started), ...Object.keys(completed)]),
  ].sort()
  if (types.length === 0)
    return (
      <p className="text-[11px] text-muted-foreground">{translateText("Sem dados ainda…")}</p>
    )

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-border text-left text-[10px] text-muted-foreground">
          <th className="pb-1.5 pr-3 font-medium">{translateText("Tipo")}</th>
          <th className="pb-1.5 pr-3 text-right font-medium">{translateText("Iniciadas")}</th>
          <th className="pb-1.5 pr-3 text-right font-medium">{translateText("Concluídas")}</th>
          <th className="pb-1.5 text-right font-medium">{translateText("Taxa")}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {types.map((t) => {
          const s = started[t] ?? 0
          const c = completed[t] ?? 0
          const rate = s > 0 ? ((c / s) * 100).toFixed(1) : "—"
          return (
            <tr key={t}>
              <td className="py-1.5 pr-3 font-mono text-[10px]">{translateText(t)}</td>
              <td className="py-1.5 pr-3 text-right font-mono text-[10px] tabular-nums">
                {translateText(s.toLocaleString(intlLocale))}
              </td>
              <td className="py-1.5 pr-3 text-right font-mono text-[10px] tabular-nums">
                {translateText(c.toLocaleString(intlLocale))}
              </td>
              <td className="py-1.5 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
                {typeof rate === "string" ? translateText(rate) : translateText("{0}%", { 0: rate })}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

const MAX_HISTORY = 60
const POLL_INTERVAL = 3000

export function MetricsPanel() {
  const { t: translateText, intlLocale } = useI18n()

  const [metrics, setMetrics] = useState<HtcMetrics | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [cpuPercent, setCpuPercent] = useState<number | null>(null)

  const tickHistory = useRef<number[]>([])
  const ratioHistory = useRef<number[]>([])
  const durationHistory = useRef<number[]>([])
  const lastCpuRef = useRef<{ value: number; time: number } | null>(null)

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch("/api/metrics", { cache: "no-store" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError((body as { error?: string }).error ?? `HTTP ${res.status}`)
        return
      }
      const data: HtcMetrics = await res.json()
      setMetrics(data)
      setError(null)

      if (data.currentTick !== null)
        tickHistory.current = [...tickHistory.current, data.currentTick].slice(-MAX_HISTORY)
      if (data.progressRatio !== null)
        ratioHistory.current = [...ratioHistory.current, data.progressRatio * 100].slice(-MAX_HISTORY)
      if (data.tickDurationAvgMs !== null)
        durationHistory.current = [...durationHistory.current, data.tickDurationAvgMs].slice(-MAX_HISTORY)

      // Compute CPU% from counter delta
      if (data.processCpuSecondsTotal !== null) {
        const now = Date.now()
        if (lastCpuRef.current !== null) {
          const dtSec = (now - lastCpuRef.current.time) / 1000
          const delta = data.processCpuSecondsTotal - lastCpuRef.current.value
          if (dtSec > 0) setCpuPercent((delta / dtSec) * 100)
        }
        lastCpuRef.current = { value: data.processCpuSecondsTotal, time: now }
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchMetrics()
    const id = setInterval(fetchMetrics, POLL_INTERVAL)
    return () => clearInterval(id)
  }, [fetchMetrics])

  const jvmHeapPct =
    metrics?.jvmHeapUsed != null && metrics?.jvmHeapMax != null
      ? (metrics.jvmHeapUsed / metrics.jvmHeapMax) * 100
      : null

  const totalActiveActors = metrics
    ? Object.values(metrics.activeActors).reduce((a, b) => a + b, 0)
    : 0

  const totalEventsProcessed = metrics
    ? Object.values(metrics.eventsProcessed).reduce((a, b) => a + b, 0)
    : 0

  const totalGcPause = metrics
    ? Object.values(metrics.gcPauseSecs).reduce((a, b) => a + b, 0)
    : 0

  const hasProgressive =
    metrics?.progressiveWindowsLoaded != null ||
    metrics?.progressiveLoadedUpToTick != null ||
    metrics?.progressiveActorsCreated != null

  const hasJvmGc = metrics != null && Object.keys(metrics.gcPauseSecs).length > 0
  const hasKafka = metrics != null && Object.keys(metrics.kafkaMessages).length > 0
  const hasThreadState = metrics != null && Object.keys(metrics.jvmThreadsState).length > 0
  const hasMemoryPools = metrics != null && Object.keys(metrics.jvmMemoryPoolsUsed).length > 0

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="size-3.5 text-muted-foreground" />
          <p className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">{translateText("Métricas Prometheus")}</p>
          {loading && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
        </div>
        <button
          onClick={fetchMetrics}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="size-3" />{translateText("Atualizar")}</button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-sm border border-destructive/30 bg-destructive/8 px-3 py-2 text-[11px] text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <div>
            <p className="font-semibold">{translateText("Não foi possível contactar o endpoint de métricas")}</p>
            <p className="mt-0.5 text-destructive/70">{translateText(error)}</p>
            <p className="mt-1 font-mono text-[10px] text-destructive/60">{translateText("Configure HTC_METRICS_URL (default: http://localhost:9001/metrics)")}</p>
          </div>
        </div>
      )}

      {metrics && (
        <>
          {/* ── SIMULAÇÃO ────────────────────────────────────────────── */}
          <SectionHeader label={translateText("Simulação")} />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MetricCard
              label={translateText("Tick atual")}
              value={metrics.currentTick != null ? metrics.currentTick.toLocaleString(intlLocale) : "—"}
              history={tickHistory.current}
            />
            <MetricCard
              label={translateText("Progresso")}
              value={metrics.progressRatio != null ? `${(metrics.progressRatio * 100).toFixed(2)}%` : "—"}
              sub={metrics.ticksTotal != null ? translateText("de {0} ticks", { 0: metrics.ticksTotal.toLocaleString(intlLocale) }) : undefined}
              history={ratioHistory.current}
            />
            <MetricCard
              label={translateText("Duração méd. tick")}
              value={metrics.tickDurationAvgMs != null ? `${metrics.tickDurationAvgMs.toFixed(1)} ms` : "—"}
              history={durationHistory.current}
              highlight={
                metrics.tickDurationAvgMs != null
                  ? metrics.tickDurationAvgMs > 500 ? "error" : metrics.tickDurationAvgMs > 200 ? "warn" : "ok"
                  : undefined
              }
            />
            <MetricCard
              label={translateText("Atores ativos")}
              value={totalActiveActors.toLocaleString(intlLocale)}
              sub={translateText("{0} tipos", { 0: Object.keys(metrics.activeActors).length })}
            />
          </div>

          {/* ── GERENCIADOR DE TEMPO ─────────────────────────────────── */}
          <SectionHeader label={translateText("Gerenciador de Tempo")} />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MetricCard
              label={translateText("TM — Scheduled")}
              value={metrics.tmScheduledActors != null ? metrics.tmScheduledActors.toLocaleString(intlLocale) : "—"}
            />
            <MetricCard
              label={translateText("TM — In-flight")}
              value={metrics.tmRunningEvents != null ? metrics.tmRunningEvents.toLocaleString(intlLocale) : "—"}
            />
            <MetricCard
              label={translateText("Aguard. progressivo")}
              value={
                metrics.tmWaitingForProgressive != null
                  ? metrics.tmWaitingForProgressive > 0 ? "Sim" : "Não"
                  : "—"
              }
              highlight={
                metrics.tmWaitingForProgressive != null && metrics.tmWaitingForProgressive > 0
                  ? "warn"
                  : undefined
              }
            />
            <MetricCard
              label={translateText("Dead letters")}
              value={metrics.deadLetters != null ? metrics.deadLetters.toLocaleString(intlLocale) : "—"}
              highlight={metrics.deadLetters != null && metrics.deadLetters > 0 ? "warn" : undefined}
            />
          </div>

          {/* ── CARGA PROGRESSIVA ────────────────────────────────────── */}
          {hasProgressive && (
            <>
              <SectionHeader label={translateText("Carga Progressiva")} />
              <div className="grid grid-cols-3 gap-2">
                <MetricCard
                  label={translateText("Windows carregadas")}
                  value={metrics.progressiveWindowsLoaded != null ? metrics.progressiveWindowsLoaded.toLocaleString(intlLocale) : "—"}
                />
                <MetricCard
                  label={translateText("Carregado até tick")}
                  value={metrics.progressiveLoadedUpToTick != null ? metrics.progressiveLoadedUpToTick.toLocaleString(intlLocale) : "—"}
                />
                <MetricCard
                  label={translateText("Atores criados")}
                  value={metrics.progressiveActorsCreated != null ? metrics.progressiveActorsCreated.toLocaleString(intlLocale) : "—"}
                />
              </div>
            </>
          )}

          {/* ── EVENTOS PROCESSADOS ──────────────────────────────────── */}
          {totalEventsProcessed > 0 && (
            <>
              <SectionHeader label={translateText("Eventos Processados")} />
              <div className="rounded-sm border border-border bg-card p-3">
                <LabelledBars
                  data={metrics.eventsProcessed}
                  label={translateText("total {0}", { 0: totalEventsProcessed.toLocaleString(intlLocale) })}
                  colorClass="bg-chart-3"
                  maxLabel={18}
                />
              </div>
            </>
          )}

          {/* ── ATORES ───────────────────────────────────────────────── */}
          <SectionHeader label={translateText("Atores")} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-sm border border-border bg-card p-3">
              <LabelledBars data={metrics.activeActors} label={translateText("Ativos por tipo")} colorClass="bg-primary" />
            </div>
            <div className="rounded-sm border border-border bg-card p-3">
              <LabelledBars data={metrics.actorsRegistered} label={translateText("Registrados total")} colorClass="bg-chart-2" />
            </div>
          </div>

          {/* ── JOURNEYS ─────────────────────────────────────────────── */}
          {(Object.keys(metrics.journeysStarted).length > 0 ||
            Object.keys(metrics.journeysCompleted).length > 0) && (
            <>
              <SectionHeader label={translateText("Journeys por Veículo")} />
              <div className="rounded-sm border border-border bg-card p-3">
                <JourneyTable started={metrics.journeysStarted} completed={metrics.journeysCompleted} />
              </div>
            </>
          )}

          {/* ── JVM — MEMÓRIA ────────────────────────────────────────── */}
          <SectionHeader label={translateText("JVM — Memória")} />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MetricCard
              label={translateText("Heap usado")}
              value={metrics.jvmHeapUsed != null ? `${(metrics.jvmHeapUsed / 1024 / 1024).toFixed(0)} MB` : "—"}
              sub={
                jvmHeapPct != null ? translateText("{0}% de {1}", { 0: jvmHeapPct.toFixed(1), 1: metrics.jvmHeapMax != null ? translateText("{0} MB", { 0: (metrics.jvmHeapMax / 1024 / 1024).toFixed(0) }) : "?" }) : undefined
              }
              highlight={jvmHeapPct != null ? jvmHeapPct > 90 ? "error" : jvmHeapPct > 75 ? "warn" : undefined : undefined}
            />
            <MetricCard
              label={translateText("Heap committed")}
              value={metrics.jvmHeapCommitted != null ? `${(metrics.jvmHeapCommitted / 1024 / 1024).toFixed(0)} MB` : "—"}
            />
            <MetricCard
              label={translateText("Non-heap usado")}
              value={metrics.jvmNonHeapUsed != null ? `${(metrics.jvmNonHeapUsed / 1024 / 1024).toFixed(0)} MB` : "—"}
              sub={
                metrics.jvmNonHeapMax != null && metrics.jvmNonHeapMax > 0 ? translateText("de {0} MB", { 0: (metrics.jvmNonHeapMax / 1024 / 1024).toFixed(0) }) : undefined
              }
            />
            <MetricCard
              label={translateText("GC pause total")}
              value={hasJvmGc ? `${totalGcPause.toFixed(3)} s` : "—"}
              sub={
                hasJvmGc ? translateText("{0} coletas", { 0: Object.values(metrics.gcCount).reduce((a, b) => a + b, 0).toLocaleString(intlLocale) }) : undefined
              }
              highlight={hasJvmGc && totalGcPause > 5 ? "warn" : undefined}
            />
          </div>

          {hasMemoryPools && (
            <div className="rounded-sm border border-border bg-card p-3">
              <p className="mb-2 text-[9px] font-semibold tracking-widest text-muted-foreground uppercase">{translateText("Memory Pools (usado / max)")}</p>
              <MemoryPoolBars used={metrics.jvmMemoryPoolsUsed} max={metrics.jvmMemoryPoolsMax} />
            </div>
          )}

          {hasJvmGc && (
            <div className="rounded-sm border border-border bg-card p-3">
              <p className="mb-2 text-[9px] font-semibold tracking-widest text-muted-foreground uppercase">{translateText("Coletores GC")}</p>
              <GcTable pauseSecs={metrics.gcPauseSecs} count={metrics.gcCount} />
            </div>
          )}

          {/* ── JVM — THREADS ────────────────────────────────────────── */}
          <SectionHeader label={translateText("JVM — Threads & CPU")} />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MetricCard
              label={translateText("Threads atuais")}
              value={metrics.jvmThreadsCurrent != null ? metrics.jvmThreadsCurrent.toLocaleString(intlLocale) : "—"}
              sub={metrics.jvmThreadsDaemon != null ? translateText("{0} daemon", { 0: metrics.jvmThreadsDaemon }) : undefined}
            />
            <MetricCard
              label={translateText("Threads pico")}
              value={metrics.jvmThreadsPeak != null ? metrics.jvmThreadsPeak.toLocaleString(intlLocale) : "—"}
            />
            <MetricCard
              label={translateText("Deadlocked")}
              value={metrics.jvmThreadsDeadlocked != null ? metrics.jvmThreadsDeadlocked.toLocaleString(intlLocale) : "—"}
              highlight={
                metrics.jvmThreadsDeadlocked != null && metrics.jvmThreadsDeadlocked > 0
                  ? "error"
                  : undefined
              }
            />
            <MetricCard
              label={translateText("CPU (Δ)")}
              value={cpuPercent != null ? `${cpuPercent.toFixed(1)}%` : "—"}
              sub={
                metrics.processCpuSecondsTotal != null ? translateText("{0} s total", { 0: metrics.processCpuSecondsTotal.toFixed(0) }) : undefined
              }
            />
          </div>

          {hasThreadState && (
            <div className="rounded-sm border border-border bg-card p-3">
              <p className="mb-2 text-[9px] font-semibold tracking-widest text-muted-foreground uppercase">{translateText("Estados das Threads")}</p>
              <div className="flex flex-col gap-0.5">
                {Object.entries(metrics.jvmThreadsState)
                  .sort((a, b) => b[1] - a[1])
                  .map(([state, count]) => {
                    const maxVal = Math.max(...Object.values(metrics.jvmThreadsState), 1)
                    const barColor = THREAD_STATE_COLORS[state] ?? "bg-muted-foreground"
                    return (
                      <div key={state} className="flex items-center gap-2">
                        <span className="w-28 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
                          {translateText(state)}
                        </span>
                        <div className="flex flex-1 items-center gap-1.5">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn("h-full rounded-full transition-all duration-300", barColor)}
                              style={{ width: `${(count / maxVal) * 100}%` }}
                            />
                          </div>
                          <span className="w-8 text-right font-mono text-[10px] tabular-nums text-foreground">
                            {translateText(count)}
                          </span>
                        </div>
                      </div>
                    )
                  })}
              </div>
            </div>
          )}

          {/* ── PROCESSO ─────────────────────────────────────────────── */}
          {(metrics.processResidentBytes != null || metrics.processOpenFds != null) && (
            <>
              <SectionHeader label={translateText("Processo")} />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {metrics.processResidentBytes != null && (
                  <MetricCard
                    label={translateText("RSS Memory")}
                    value={`${(metrics.processResidentBytes / 1024 / 1024).toFixed(0)} MB`}
                  />
                )}
                {metrics.processOpenFds != null && (
                  <MetricCard
                    label={translateText("FDs abertos")}
                    value={metrics.processOpenFds.toLocaleString(intlLocale)}
                    sub={metrics.processMaxFds != null ? translateText("de {0}", { 0: metrics.processMaxFds.toLocaleString(intlLocale) }) : undefined}
                    highlight={
                      metrics.processMaxFds != null &&
                      metrics.processOpenFds / metrics.processMaxFds > 0.8
                        ? "warn"
                        : undefined
                    }
                  />
                )}
              </div>
            </>
          )}

          {/* ── KAFKA ────────────────────────────────────────────────── */}
          {hasKafka && (
            <>
              <SectionHeader label={translateText("Kafka")} />
              <div className="rounded-sm border border-border bg-card p-3">
                <LabelledBars data={metrics.kafkaMessages} label={translateText("Mensagens por tópico")} colorClass="bg-chart-4" />
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
