"use client"

import { useI18n } from "@/components/i18n-provider"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import {
  Activity,
  AlertCircle,
  FolderOpen,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  ScrollText,
  Settings2,
  Square,
  Upload,
  X,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { LogsPanel } from "@/components/logs-panel"
import { MetricsDashboard } from "@/components/metrics/dashboard"
import { ModificationPicker } from "@/components/modifications/modification-picker"
import { ConfigEditor } from "@/components/simulator/config-editor"
import { EnvSettingsPanel } from "@/components/simulator/env-settings-panel"
import { OutputPanel } from "@/components/simulator/output-panel"
import { simulationStartPlan, type DerivedRunConfig } from "@/lib/simulation-start"
import {
  deleteSettings,
  deleteSimulationConfig,
  getHtcApiBase,
  getSettings,
  getSimulationConfig,
  getSimulationStatus,
  pauseSimulation,
  putSettings,
  putSimulationConfig,
  resumeSimulation,
  probeEngine,
  setHtcApiBase,
  startSimulation,
  stopSimulation,
  resetSimulation,
  type HealthResponse,
  type Setting,
  type SimulationConfig,
  type SimulationStatus,
  type StatusResponse,
} from "@/lib/htc-api"
import {
  createPartialConfig,
  getAllScenarios,
  getPartialReport,
  type PartialReport,
  getEnginePath,
  listEngines,
  type SimEngine,
} from "@/lib/simedape-api"

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<SimulationStatus, string> = {
  Idle: "bg-muted text-muted-foreground border-border",
  Loading: "bg-chart-1/20 text-chart-2 border-chart-1/30",
  Running:
    "bg-green-500/10 text-green-600 border-green-500/30 dark:text-green-400",
  Paused:
    "bg-yellow-500/10 text-yellow-600 border-yellow-500/30 dark:text-yellow-400",
  Stopped: "bg-destructive/10 text-destructive border-destructive/30",
  Failed: "bg-destructive/10 text-destructive border-destructive/30",
  Resetting: "bg-chart-1/20 text-chart-2 border-chart-1/30",
}

const STATUS_DOT: Record<SimulationStatus, string> = {
  Idle: "bg-muted-foreground",
  Loading: "bg-chart-2 animate-pulse",
  Running: "bg-green-500 animate-pulse",
  Paused: "bg-yellow-500",
  Stopped: "bg-destructive",
  Failed: "bg-destructive",
  Resetting: "bg-chart-2 animate-pulse",
}

function StatusBadge({ status }: { status: SimulationStatus }) {
  const { t: translateText } = useI18n()

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] font-semibold tracking-widest uppercase",
        STATUS_COLORS[status]
      )}
    >
      <span className={cn("size-1.5 rounded-full", STATUS_DOT[status])} />
      {translateText(status)}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

function ProgressBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, value * 100))
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-primary transition-all duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Error toast (inline)
// ---------------------------------------------------------------------------

function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string
  onDismiss: () => void
}) {
  const { t: translateText } = useI18n()

  return (
    <div className="flex items-start gap-2 rounded-sm border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
      <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
      <span className="flex-1">{translateText(message)}</span>
      <button onClick={onDismiss} className="shrink-0 hover:opacity-70">
        <X className="size-3" />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section card
// ---------------------------------------------------------------------------

function Card({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  

  return (
    <div
      className={cn(
        "rounded-sm border border-border bg-card p-4 text-card-foreground",
        className
      )}
    >
      {children}
    </div>
  )
}

function CardTitle({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  

  return (
    <p
      className={cn(
        "text-[10px] font-semibold tracking-widest text-muted-foreground uppercase",
        className
      )}
    >
      {children}
    </p>
  )
}

// ---------------------------------------------------------------------------
// Settings panel
// ---------------------------------------------------------------------------

function SettingsPanel({
  settings,
  onSave,
  onClearAll,
}: {
  settings: Setting[]
  onSave: (overrides: Record<string, string>) => Promise<void>
  onClearAll: () => Promise<void>
}) {
  const { t: translateText } = useI18n()

  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [clearing, setClearing] = useState(false)

  const apiOverrides = settings.filter((s) => s.source === "api_override")

  async function handleSave() {
    if (Object.keys(overrides).length === 0) return
    setSaving(true)
    try {
      await onSave(overrides)
      setOverrides({})
    } finally {
      setSaving(false)
    }
  }

  async function handleClearAll() {
    setClearing(true)
    try {
      await onClearAll()
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <CardTitle>{translateText("Settings Override")}</CardTitle>
        {apiOverrides.length > 0 && (
          <Button
            variant="ghost"
            size="xs"
            onClick={handleClearAll}
            disabled={clearing}
          >
            {clearing ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <RotateCcw className="size-3" />
            )}{translateText("Clear all overrides")}</Button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-[10px] text-muted-foreground">
              <th className="pr-3 pb-1.5 font-medium">{translateText("Key")}</th>
              <th className="pr-3 pb-1.5 font-medium">{translateText("Current")}</th>
              <th className="pr-3 pb-1.5 font-medium">{translateText("Source")}</th>
              <th className="pb-1.5 font-medium">{translateText("Override")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {settings.map((s) => (
              <tr key={s.key} className="group">
                <td className="py-2 pr-3 font-mono text-[10px] text-foreground">
                  {translateText(s.key)}
                </td>
                <td className="py-2 pr-3 font-mono text-[10px] text-muted-foreground">
                  {overrides[s.key] !== undefined ? (
                    <span className="text-primary">{translateText(overrides[s.key])}</span>
                  ) : (
                    s.currentValue
                  )}
                </td>
                <td className="py-2 pr-3">
                  <span
                    className={cn(
                      "rounded-sm border px-1.5 py-0.5 text-[9px] font-medium tracking-wider uppercase",
                      s.source === "api_override"
                        ? "border-primary/30 bg-primary/10 text-primary"
                        : "border-border bg-muted text-muted-foreground"
                    )}
                  >
                    {translateText(s.source.replace("_", " "))}
                  </span>
                </td>
                <td className="py-2">
                  <input
                    type="text"
                    value={overrides[s.key] ?? ""}
                    placeholder={translateText(s.defaultValue)}
                    onChange={(e) =>
                      setOverrides((prev) => {
                        const next = { ...prev }
                        if (e.target.value === "") {
                          delete next[s.key]
                        } else {
                          next[s.key] = e.target.value
                        }
                        return next
                      })
                    }
                    className="h-6 w-32 rounded-sm border border-input bg-background px-2 font-mono text-[10px] text-foreground placeholder:text-muted-foreground/50 focus:border-ring focus:ring-1 focus:ring-ring/30 focus:outline-none"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {Object.keys(overrides).length > 0 && (
        <div className="flex justify-end">
          <Button size="xs" onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Upload className="size-3" />
            )}{translateText("Apply ")}{translateText(Object.keys(overrides).length)}{translateText(" override")}{Object.keys(overrides).length !== 1 ? translateText("s") : translateText("")}
          </Button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Config panel
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const TAB_IDS = ["metrics", "logs", "config", "settings", "env", "output"] as const
type Tab = (typeof TAB_IDS)[number]

export default function SimulatorPage() {
  const { t: translateText, intlLocale } = useI18n()

  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [settings, setSettings] = useState<Setting[]>([])
  const [configJson, setConfigJson] = useState<string>("{}")
  const [appliedConfig, setAppliedConfig] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [engineGeneration, setEngineGeneration] = useState(0)
  const [tab, setTab] = useState<Tab | null>(null)
  // Pending application.conf changes, shared by the Ambiente and Saída tabs (remembered in this browser).
  const [envOverrides, setEnvOverrides] = useState<Record<string, string>>({})
  const [startConfigFile, setStartConfigFile] = useState("")
  // Optional partial run: a SimEDaPE selection manifest; the page then starts from a derived simulation.partial.json
  const [partialSelection, setPartialSelection] = useState("")
  const [modFiles, setModFiles] = useState<string[]>([])
  const [partialClasses, setPartialClasses] = useState("Person,Car,Bicycle,Motorcycle")
  const [partialReport, setPartialReport] = useState<PartialReport | null>(null)
  const [activeScenario, setActiveScenario] = useState<string | null>(null)
  const [engines, setEngines] = useState<SimEngine[]>([])
  const [engineId, setEngineId] = useState<string | null>(null)
  // null = still checking; true = answering; string = reason it is not
  const [engineUp, setEngineUp] = useState<boolean | string | null>(null)
  const [scenarioOptions, setScenarioOptions] = useState<
    Awaited<ReturnType<typeof getAllScenarios>>["scenarios"]
  >([])
  const [scenarioErrors, setScenarioErrors] = useState<string[]>([])
  const [scenarioRef, setScenarioRef] = useState("")
  const [manualPath, setManualPath] = useState(false)
  const engine = useMemo(
    () => engines.find((e) => e.id === engineId) ?? null,
    [engines, engineId]
  )
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Derived
  const simStatus = actionLoading === "reset" ? "Resetting" : status?.status ?? health?.simulationStatus ?? "Idle"
  // The engine reports the simulation.json it loaded; its `partial` block marks the run as partial.
  const loadedModifications = useMemo<string[]>(() => {
    try {
      const m = (JSON.parse(configJson) as { modifications?: { files?: string[] } }).modifications
      return (m?.files ?? []).map((f) => f.split("/").pop() ?? f)
    } catch {
      return []
    }
  }, [configJson])
  const loadedPartial = useMemo<{ selectionFile: string } | null>(() => {
    try {
      const p = (JSON.parse(configJson) as { partial?: { selectionFile?: string } }).partial
      return p?.selectionFile ? { selectionFile: p.selectionFile } : null
    } catch {
      return null
    }
  }, [configJson])

  // -------------------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------------------

  const statusRequest = useRef(false)
  const fetchAll = useCallback(async () => {
    if (statusRequest.current) return
    statusRequest.current = true
    try {
      const s = await getSimulationStatus()
      setHealth({ status: "ok", simulationStatus: s.status, apiConfigLoaded: s.apiConfigLoaded })
      setStatus(s)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      statusRequest.current = false
    }
  }, [])

  const fetchSettings = useCallback(async () => {
    try {
      const res = await getSettings()
      setSettings(res.settings)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  const fetchConfig = useCallback(async () => {
    try {
      const res = await getSimulationConfig()
      setConfigJson(res.config ? JSON.stringify(res.config, null, 2) : "{}")
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  // Engines come from the shared registry (Locais); the choice is remembered per browser.
  useEffect(() => {
    let active = true
    listEngines()
      .then((r) => r.engines)
      .catch(() => [{ id: "default", url: getHtcApiBase(), label: "Engine local" }])
      .then((list) => {
        if (!active) return
        setEngines(list)
        let saved: string | null = null
        try {
          saved = localStorage.getItem("htc.engine")
        } catch {
          /* storage unavailable: keep the default */
        }
        setEngineId(list.find((e) => e.id === saved)?.id ?? list[0]?.id ?? null)
      })
    return () => {
      active = false
    }
  }, [])

  const connect = useCallback(async () => {
    if (!engine) return
    setHtcApiBase(engine.url)
    setEngineUp(null)
    const r = await probeEngine(engine.url)
    if (!r.ok) {
      setEngineUp(r.reason)
      setHealth(null)
      setStatus(null)
      return
    }
    setEngineUp(true)
    fetchAll()
    fetchSettings()
    fetchConfig()
  }, [engine, fetchAll, fetchSettings, fetchConfig])

  useEffect(() => {
    void connect()
  }, [connect])

  // While the engine is unreachable keep retrying quietly.
  useEffect(() => {
    if (typeof engineUp !== "string") return
    const t = setInterval(() => void connect(), 8000)
    return () => clearInterval(t)
  }, [engineUp, connect])

  // Scenarios the selected engine can start (restricted to its location when one is set).
  useEffect(() => {
    if (!engineId) return
    let active = true
    getAllScenarios(engineId)
      .then((r) => {
        if (!active) return
        setScenarioOptions(r.scenarios)
        setScenarioErrors(r.errors.map((e) => `${e.location}: ${e.error}`))
        setScenarioRef((cur) => (r.scenarios.some((s) => s.ref === cur) ? cur : ""))
      })
      .catch(() => {
        if (active) {
          setScenarioOptions([])
          setScenarioErrors([])
        }
      })
    return () => {
      active = false
    }
  }, [engineId])

  // Poll status while running or loading
  useEffect(() => { setAppliedConfig(null) }, [engineId, scenarioRef])

  // Poll status while running or loading
  useEffect(() => {
    if (pollingRef.current) clearInterval(pollingRef.current)
    if (engineUp === true && actionLoading !== "reset") {
      pollingRef.current = setInterval(() => {
        if (document.visibilityState === "visible") void fetchAll()
      }, simStatus === "Running" || simStatus === "Loading" ? 2000 : 10000)
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [simStatus, engineUp, actionLoading, fetchAll])

  // -------------------------------------------------------------------------
  // Lifecycle actions
  // -------------------------------------------------------------------------

  async function withAction(name: string, fn: () => Promise<unknown>) {
    setActionLoading(name)
    setError(null)
    try {
      await fn()
      await fetchAll()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setActionLoading(null)
    }
  }

  // The loaded config appears after the load starts: refresh it when the run status changes.
  useEffect(() => {
    if (engineUp === true) void fetchConfig()
  }, [simStatus, engineUp, fetchConfig])
  useEffect(() => {
    if (!loadedPartial) {
      setPartialReport(null)
      return
    }
    let cancelled = false
    const load = () => getPartialReport(loadedPartial.selectionFile).then((r) => !cancelled && setPartialReport(r)).catch(() => {})
    void load()
    const t = setInterval(load, 4000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [loadedPartial])

  function handleStart() {
    withAction("start", async () => {
      let configFile = ""
      let derivedConfig: DerivedRunConfig | undefined
      if (manualPath) {
        configFile = startConfigFile.trim()
      } else if (scenarioRef) {
        // The engine needs the path it sees (container / shared mount), not the host path.
        if (partialSelection.trim() || modFiles.length > 0) {
          const derived = await createPartialConfig({
            ref: scenarioRef,
            ...(partialSelection.trim() ? { selection_file: partialSelection.trim(), filterable_classes: partialClasses.split(",").map((x) => x.trim()).filter(Boolean) } : {}),
            modification_files: modFiles,
          })
          if (derived.problems.length) throw new Error(`simulation.partial.json inválido: ${derived.problems.join("; ")}`)
          derivedConfig = derived
          configFile = derived.engine_path
        } else {
          configFile = `${(await getEnginePath(scenarioRef)).engine_path}/simulation.json`
        }
        setActiveScenario(scenarioRef.slice(scenarioRef.indexOf(":") + 1))
      }
      const plan = simulationStartPlan({ configFile, manualPath, appliedConfig, derived: derivedConfig })
      if (plan.config) await putSimulationConfig(plan.config as unknown as SimulationConfig)
      await startSimulation(plan.body)
    })
  }
  function handlePause() {
    withAction("pause", pauseSimulation)
  }
  function handleResume() {
    withAction("resume", resumeSimulation)
  }
  function handleStop() {
    withAction("stop", stopSimulation)
  }
  function handleReset() {
    void withAction("reset", async () => {
      await resetSimulation()
      setAppliedConfig(null)
      setConfigJson("{}")
      setActiveScenario("")
      setConfirmReset(false)
      setEngineGeneration((value) => value + 1)
      await Promise.all([fetchSettings(), fetchConfig()])
    })
  }

  // -------------------------------------------------------------------------
  // Settings / config actions
  // -------------------------------------------------------------------------

  async function handleSaveSettings(overrides: Record<string, string>) {
    await putSettings(overrides)
    await fetchSettings()
  }

  async function handleClearSettings() {
    await deleteSettings()
    await fetchSettings()
  }

  async function handleApplyConfig(config: Record<string, unknown>) {
    await putSimulationConfig(config as unknown as SimulationConfig)
    setAppliedConfig(config)
    await fetchConfig()
  }

  async function handleClearConfig() {
    await deleteSimulationConfig()
    setAppliedConfig(null)
    await fetchConfig()
  }

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  const canStart = simStatus === "Idle"
  const canPause = simStatus === "Running"
  const canResume = simStatus === "Paused"
  const canStop =
    simStatus === "Running" || simStatus === "Paused" || simStatus === "Loading"

  const tickPct = status?.progressRatio ?? 0

  const overrideCount = settings.filter((x) => x.source === "api_override").length
  const tabGroups: {
    label: string
    tabs: { id: Tab; label: string; icon: typeof Activity; badge?: string; hint: string }[]
  }[] = [
    {
      label: "Observação",
      tabs: [
        { id: "metrics", label: "Métricas", icon: Activity, hint: "Métricas do engine (Prometheus): gráficos por assunto, exportáveis em CSV, JSON, PNG, JPEG, SVG e PDF. Lidas pelo servidor do HTC View (HTC_METRICS_URL), não pelo engine selecionado acima." },
        { id: "logs", label: "Logs", icon: ScrollText, hint: "Logs do engine, do bus-live e da interface. Usa a API do próprio HTC View." },
      ],
    },
    {
      label: "Configuração",
      tabs: [
        { id: "config", label: "Cenário", icon: Upload, badge: health?.apiConfigLoaded ? "override" : undefined, hint: "simulation.json do cenário selecionado em Execução: edite em formulário ou JSON, aplique ao engine ou grave no cenário." },
        { id: "settings", label: "Settings", icon: Settings2, badge: overrideCount ? String(overrideCount) : undefined, hint: "Settings do simulador (variáveis de ambiente do engine) alteráveis em tempo de execução." },
        { id: "env", label: "Ambiente", icon: ScrollText, hint: "Todas as variáveis de ambiente e chaves do application.conf do engine: edite e exporte para .env, docker-compose, Kubernetes ou HOCON." },
        { id: "output", label: "Saída", icon: FolderOpen, hint: "Para onde o engine grava os resultados e como ele os reporta." },
      ],
    },
  ]
  // Until the user picks a section: metrics while a simulation is live, otherwise the scenario configuration.
  const activeTab: Tab =
    tab ?? (simStatus === "Running" || simStatus === "Paused" ? "metrics" : "config")

  useEffect(() => {
    try {
      const saved = localStorage.getItem("htc.env-overrides")
      if (saved) setEnvOverrides(JSON.parse(saved))
    } catch {
      /* storage unavailable: drafts just aren't remembered */
    }
  }, [])
  useEffect(() => {
    try {
      localStorage.setItem("htc.env-overrides", JSON.stringify(envOverrides))
    } catch {
      /* storage unavailable */
    }
  }, [envOverrides])

  // Remembered in the URL (?tab=...) so reloads and shared links open the same section.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("tab")
    if (q && (TAB_IDS as readonly string[]).includes(q)) setTab(q as Tab)
  }, [])
  function selectTab(t: Tab) {
    setTab(t)
    const url = new URL(window.location.href)
    url.searchParams.set("tab", t)
    window.history.replaceState(null, "", url)
  }
  function onTabKey(e: React.KeyboardEvent, id: Tab) {
    const order = tabGroups.flatMap((g) => g.tabs.map((x) => x.id))
    const at = order.indexOf(id)
    const next =
      e.key === "ArrowRight" ? order[(at + 1) % order.length]
      : e.key === "ArrowLeft" ? order[(at - 1 + order.length) % order.length]
      : e.key === "Home" ? order[0]
      : e.key === "End" ? order[order.length - 1]
      : null
    if (!next) return
    e.preventDefault()
    selectTab(next)
    document.getElementById(`tab-${next}`)?.focus()
  }

  return (
    <div className="flex flex-col gap-5 p-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-xl font-semibold tracking-tight">{translateText("Hyperbolic Time Chamber")}</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">{translateText("Gerenciamento do simulador")}</p>
        </div>
        <button
          onClick={fetchAll}
          className="flex items-center gap-1.5 rounded-sm border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
        >
          <RotateCcw
            className={cn(
              "size-3",
              actionLoading === "refresh" && "animate-spin"
            )}
          />{translateText("Refresh")}</button>
      </div>

      {/* Engine: which running HTC this page controls (registry: Locais → Engines) */}
      <div className="flex flex-wrap items-center gap-3 rounded-sm border border-border bg-card px-4 py-3">
        <span className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">{translateText("Engine")}</span>
        <select
          aria-label={translateText("Engine")}
          className="h-8 rounded-sm border border-input bg-background px-2 text-xs"
          value={engineId ?? ""}
          onChange={(e) => {
            setEngineId(e.target.value)
            try {
              localStorage.setItem("htc.engine", e.target.value)
            } catch {
          /* storage unavailable: keep the default */
        }
          }}
        >
          {engines.map((e) => (
            <option key={e.id} value={e.id}>
              {translateText(e.label || e.id)}
              {e.nodes ? translateText(" · {0} nós", { 0: e.nodes }) : translateText("")}
            </option>
          ))}
        </select>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">{translateText(engine?.url)}</span>
        <span
          role="status"
          className={cn(
            "inline-flex items-center gap-1.5 text-xs",
            engineUp === true && "text-green-600 dark:text-green-400",
            typeof engineUp === "string" && "text-red-600 dark:text-red-400",
            engineUp === null && "text-muted-foreground"
          )}
        >
          <span className={cn("size-2 rounded-full", engineUp === true ? "bg-green-500" : typeof engineUp === "string" ? "bg-red-500" : "bg-muted-foreground")} />
          {engineUp === true ? translateText("online") : engineUp === null ? translateText("verificando…") : translateText("offline")}
        </span>
        <Link href="/locations" className="text-xs text-muted-foreground underline hover:text-foreground">{translateText("Gerenciar engines e locais")}</Link>
      </div>

      {typeof engineUp === "string" && (
        <div className="flex flex-col gap-2 rounded-sm border border-red-500/30 bg-red-500/10 p-4 text-xs" role="alert">
          <p className="font-semibold text-red-600 dark:text-red-400">{translateText("O engine “")}{translateText(engine?.label || engine?.id)}{translateText("” não responde em ")}{translateText(engine?.url)}
          </p>
          <p className="text-muted-foreground">{translateText("Motivo: ")}{translateText(engineUp)}{translateText(". Tentando de novo a cada 8 s.")}</p>
          <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
            <li>{translateText("O engine precisa estar rodando com ")}<code className="font-mono">HTC_API_ENABLED=true</code>{translateText(" (a porta é ")}<code className="font-mono">HTC_API_PORT</code>{translateText(", padrão 9804).")}</li>
            <li>{translateText("Docker: confira o mapeamento de porta no compose. GKE/VM: use um túnel, ex. ")}<code className="font-mono">kubectl port-forward svc/htc 9804:9804</code>.</li>
            <li>{translateText("Se o endereço estiver errado, corrija em Gerenciar engines.")}</li>
          </ul>
          <div>
            <Button size="sm" variant="outline" onClick={() => void connect()}>{translateText("Tentar agora")}</Button>
          </div>
        </div>
      )}

      {error && (
        <ErrorBanner message={error} onDismiss={() => setError(null)} />
      )}

      {engineUp === true && (
      <>
      {/* Status row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardTitle className="mb-2">{translateText("Status")}</CardTitle>
          <StatusBadge status={simStatus as SimulationStatus} />
          {loadedModifications.length > 0 && (
            <p className="mt-2 inline-block rounded-sm border border-yellow-500/50 bg-yellow-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-yellow-700 dark:text-yellow-400" title={translateText("Modificações aplicadas, em ordem")}>{translateText("Alterada · ")}{translateText(loadedModifications.join(" + "))}
            </p>
          )}
          {loadedPartial && (
            <p
              className="mt-2 inline-block rounded-sm border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-primary"
              title={translateText("Seleção: {0}", { 0: loadedPartial.selectionFile })}
            >{translateText("Parcial")}{partialReport ? translateText(" · {0} de {1}", { 0: partialReport.kept, 1: partialReport.filterable_actors }) : translateText("")}
            </p>
          )}
        </Card>

        <Card>
          <CardTitle className="mb-2">{status?.timeManagerType === "time-warp" ? translateText("Tick confirmado (GVT)") : translateText("Tick atual")}</CardTitle>
          <p className="font-mono text-lg font-semibold tabular-nums">
            {translateText(status?.currentTick?.toLocaleString(intlLocale) ?? "—")}
          </p>
          {status?.timeManagerType === "time-warp" && <p className="text-[10px] text-muted-foreground">GVT: {status.gvt?.toLocaleString(intlLocale) ?? "—"}</p>}
        </Card>

        <Card>
          <CardTitle className="mb-2">{translateText("Progresso")}</CardTitle>
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-lg font-semibold tabular-nums">
              {status ? translateText("{0}%", { 0: (tickPct * 100).toFixed(1) }) : translateText("—")}
            </span>
            <ProgressBar value={tickPct} />
          </div>
        </Card>

        <Card>
          <CardTitle className="mb-2">{translateText("Overrides ativos")}</CardTitle>
          <p className="font-mono text-lg font-semibold tabular-nums">
            {translateText(status?.settingOverrides ?? "—")}
          </p>
        </Card>
      </div>

      {/* Controls */}
      <Card>
        <CardTitle className="mb-3">{translateText("Execução")}</CardTitle>

        {canStart && (
          <div className="mb-3 flex flex-col gap-2">
            {manualPath ? (
              <label className="flex flex-col gap-1 text-xs">{translateText("Caminho do simulation.json (como o engine o enxerga)")}<input
                  type="text"
                  value={startConfigFile}
                  onChange={(e) => setStartConfigFile(e.target.value)}
                  placeholder={translateText("/app/hyperbolic-time-chamber/simulations/input/meu-cenario/simulation.json")}
                  className="h-8 rounded-sm border border-input bg-background px-3 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:ring-1 focus:ring-ring/30 focus:outline-none"
                />
              </label>
            ) : (
              <label className="flex flex-col gap-1 text-xs">{translateText("Cenário")}<select
                  aria-label={translateText("Cenário")}
                  className="h-8 rounded-sm border border-input bg-background px-2 text-xs"
                  value={scenarioRef}
                  onChange={(e) => setScenarioRef(e.target.value)}
                >
                  <option value="">{translateText("Configuração atual do engine (sem trocar de cenário)")}</option>
                  {Object.entries(
                    scenarioOptions.reduce<Record<string, typeof scenarioOptions>>((g, sc) => {
                      ;(g[sc.location_label] ??= []).push(sc)
                      return g
                    }, {})
                  ).map(([group, items]) => (
                    <optgroup key={group} label={translateText(group)}>
                      {items.map((sc) => (
                        <option key={sc.ref} value={sc.ref}>
                          {translateText(sc.name)}
                          {sc.map_mode === "osm" ? translateText(" · OSM") : translateText("")}
                          {sc.duration != null ? translateText(" · {0}s", { 0: sc.duration }) : translateText("")}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <span className="text-[11px] text-muted-foreground">
                  {engine?.location ? translateText("Mostrando os cenários do local “{0}”, o que este engine enxerga.", { 0: engine.location }) : translateText("Mostrando os cenários de todos os locais de entrada.")}{" "}{translateText("O caminho enviado ao engine é o que ele enxerga (container / montagem compartilhada).")}</span>
              </label>
            )}
            {scenarioErrors.map((m) => (
              <p key={m} className="text-[11px] text-yellow-700 dark:text-yellow-400">{translateText("Local indisponível — ")}{translateText(m.slice(0, 160))}</p>
            ))}
            {!manualPath && scenarioRef && (
              <div className="flex flex-col gap-1.5 rounded-sm border border-border p-2 text-xs">
                <ModificationPicker scenarioRef={scenarioRef} value={modFiles} onChange={setModFiles} compact />
                <span className="mt-1 font-medium">{translateText("Simulação parcial (opcional)")}</span>
                <input
                  type="text"
                  value={partialSelection}
                  onChange={(e) => setPartialSelection(e.target.value)}
                  placeholder={translateText("Caminho do selection.json do SimEDaPE (vazio = simulação completa)")}
                  className="h-8 rounded-sm border border-input bg-background px-3 font-mono text-[11px] placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none"
                />
                {partialSelection.trim() && (
                  <>
                    <input
                      type="text"
                      value={partialClasses}
                      onChange={(e) => setPartialClasses(e.target.value)}
                      className="h-8 rounded-sm border border-input bg-background px-3 font-mono text-[11px] focus:border-ring focus:outline-none"
                    />
                    <span className="text-[11px] text-muted-foreground">{translateText("O cenário não é alterado: a tela grava um simulation.partial.json ao lado dele. Só as classes acima podem ser removidas; ônibus, metrô e estações ficam completos. O engine precisa ler a seleção neste caminho.")}</span>
                  </>
                )}
              </div>
            )}
            <button
              type="button"
              className="self-start text-[11px] text-muted-foreground underline hover:text-foreground"
              onClick={() => setManualPath((m) => !m)}
            >
              {manualPath ? translateText("Escolher da lista") : translateText("Informar o caminho manualmente")}
            </button>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {canStart && (
            <Button
              onClick={handleStart}
              disabled={actionLoading !== null}
              size="sm"
            >
              {actionLoading === "start" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5" />
              )}{translateText("Iniciar")}</Button>
          )}

          {canPause && (
            <Button
              onClick={handlePause}
              disabled={actionLoading !== null}
              variant="outline"
              size="sm"
            >
              {actionLoading === "pause" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Pause className="size-3.5" />
              )}{translateText("Pausar")}</Button>
          )}

          {canResume && (
            <Button
              onClick={handleResume}
              disabled={actionLoading !== null}
              size="sm"
            >
              {actionLoading === "resume" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5" />
              )}{translateText("Retomar")}</Button>
          )}

          {canStop && (
            <Button
              onClick={handleStop}
              disabled={actionLoading !== null}
              variant="destructive"
              size="sm"
            >
              {actionLoading === "stop" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Square className="size-3.5" />
              )}{translateText("Parar")}</Button>
          )}

          <Button size="sm" variant="outline" disabled={actionLoading !== null} onClick={() => {
            if (canStop) setConfirmReset(true)
            else handleReset()
          }}>
            {actionLoading === "reset" ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
            {actionLoading === "reset" ? translateText("Limpando engine…") : translateText("Limpar engine")}
          </Button>
          {confirmReset && <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span>{translateText("A execução atual será interrompida. Cenários e relatórios já salvos serão mantidos.")}</span>
            <Button size="sm" variant="destructive" onClick={handleReset} disabled={actionLoading !== null}>{translateText("Confirmar limpeza")}</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmReset(false)}>{translateText("Cancelar")}</Button>
          </div>}

          {(activeScenario || scenarioRef) && (
            <Button asChild size="sm" variant="outline">
              <Link target="_blank" href={`/simulator/live?scenario=${encodeURIComponent(activeScenario || scenarioRef.slice(scenarioRef.indexOf(":")+1))}&background=osm${activeScenario && status?.simulationId ? `&simulationId=${encodeURIComponent(status.simulationId)}` : ""}`}>
                <Activity className="size-3.5" />{translateText("Abrir visualização no mapa (OSM)")}
              </Link>
            </Button>
          )}

          <Button asChild size="sm" variant="outline">
            <Link
              href={
                activeScenario
                  ? `/simulator/replay?scenario=${encodeURIComponent(activeScenario)}`
                  : "/simulator/replay"
              }
            >
              <RotateCcw className="size-3.5" />{translateText("Ver replay")}</Link>
          </Button>

          {simStatus === "Running" && (
            <div className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />{translateText("Polling a cada 2s…")}</div>
          )}
        </div>
        <p className="mt-3 border-t border-border pt-3 text-[11px] text-muted-foreground">{translateText("Precisa de uma execução única com resultados salvos e replay, sem engine em serviço?")}{" "}
          <Link href="/simulator/runs" className="text-primary underline">{translateText("Executar um cenário")}</Link>.
        </p>
      </Card>

      </>
      )}

      {/* Sections do not need the engine's control API (metrics, environment and output read other services), so they stay available when it is offline. */}
      {/* Sections: one visible at a time, grouped (replaces the former accordions) */}
      <section aria-label={translateText("Seções do simulador")} className="rounded-sm border border-border bg-card">
        <div
          role="tablist"
          aria-label={translateText("Seções do simulador")}
          className="flex flex-wrap items-center gap-y-1 border-b border-border px-2 pt-1"
        >
          {tabGroups.map((g, gi) => (
            <div
              key={g.label}
              className={cn("flex flex-wrap items-end", gi > 0 && "ml-3 border-l border-border pl-3")}
            >
              <span className="self-center pr-2 text-[9px] font-semibold tracking-widest text-muted-foreground uppercase">
                {translateText(g.label)}
              </span>
              {g.tabs.map((t) => {
                const Icon = t.icon
                const selected = activeTab === t.id
                return (
                  <button
                    key={t.id}
                    id={`tab-${t.id}`}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls={`panel-${t.id}`}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => selectTab(t.id)}
                    onKeyDown={(e) => onTabKey(e, t.id)}
                    className={cn(
                      "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors",
                      selected
                        ? "border-primary text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Icon className="size-3.5 shrink-0" />
                    {translateText(t.label)}
                    {t.badge && (
                      <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
                        {translateText(t.badge)}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
        <div
          role="tabpanel"
          id={`panel-${activeTab}`}
          aria-labelledby={`tab-${activeTab}`}
          className="flex flex-col gap-3 p-4"
        >
          <p className="text-[11px] text-muted-foreground">
            {translateText(tabGroups.flatMap((g) => g.tabs).find((t) => t.id === activeTab)?.hint)}
          </p>
          {activeTab === "metrics" && <MetricsDashboard key={engineGeneration} />}
          {activeTab === "logs" && <LogsPanel />}
          {activeTab === "config" && (
            <ConfigEditor
              scenarioRef={scenarioRef}
              engineConfigJson={configJson}
              onApplyToEngine={handleApplyConfig}
              onClearEngine={handleClearConfig}
            />
          )}
          {activeTab === "settings" && (
            <SettingsPanel
              settings={settings}
              onSave={handleSaveSettings}
              onClearAll={handleClearSettings}
            />
          )}
          {activeTab === "env" && (
            <EnvSettingsPanel liveSettings={settings} onApplyLive={handleSaveSettings} overrides={envOverrides} setOverrides={setEnvOverrides} />
          )}
          {activeTab === "output" && (
            <OutputPanel settings={settings} onSaveSettings={handleSaveSettings} setOverrides={setEnvOverrides} onOpenEnv={() => selectTab("env")} />
          )}
        </div>
      </section>

    </div>
  )
}
