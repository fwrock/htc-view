"use client"

import { useI18n } from "@/components/i18n-provider"

import { useCallback, useEffect, useState } from "react"
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  FolderOpen,
  Info,
  Loader2,
  RefreshCw,
  Tag,
  User,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import {
  getScenario,
  getScenarios,
  loadScenario,
  type ScenarioDetailResponse,
  type ScenarioSummary,
} from "@/lib/htc-api"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(seconds: number | null, unit: string | null): string {
  if (seconds === null) return "—"
  const s = unit === "seconds" ? seconds : seconds // already normalised
  if (s < 3600) return `${s}s`
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

// ---------------------------------------------------------------------------
// Detail drawer (inline expand)
// ---------------------------------------------------------------------------

function ScenarioDetail({
  name,
  onLoad,
  activeScenario,
}: {
  name: string
  onLoad: (name: string) => Promise<void>
  activeScenario: string | null
}) {
  const { t: translateText, intlLocale } = useI18n()

  const [detail, setDetail] = useState<ScenarioDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadingAction, setLoadingAction] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    setLoading(true)
    getScenario(name)
      .then(setDetail)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [name])

  async function handleLoad() {
    setLoadingAction(true)
    setLoaded(false)
    try {
      await onLoad(name)
      setLoaded(true)
    } finally {
      setLoadingAction(false)
    }
  }

  if (loading)
    return (
      <div className="flex items-center gap-2 px-2 py-3 text-[11px] text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />{translateText(" A carregar detalhes…")}</div>
    )

  if (error)
    return (
      <div className="flex items-start gap-1.5 px-2 py-2 text-[11px] text-destructive">
        <AlertCircle className="mt-0.5 size-3 shrink-0" />
        {translateText(error)}
      </div>
    )

  if (!detail) return null

  const sim = detail.simulation
  const meta = detail.meta

  return (
    <div className="flex flex-col gap-4 px-2 py-3">
      {/* Meta */}
      {meta && (
        <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
          {meta.description && (
            <span className="flex items-center gap-1">
              <Info className="size-3 shrink-0" />
              {translateText(meta.description)}
            </span>
          )}
          {meta.author && (
            <span className="flex items-center gap-1">
              <User className="size-3 shrink-0" />
              {translateText(meta.author)}
            </span>
          )}
          {meta.version && (
            <span className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-[9px]">{translateText("v")}{translateText(meta.version)}
            </span>
          )}
          {meta.tags && meta.tags.length > 0 && (
            <span className="flex items-center gap-1">
              <Tag className="size-3 shrink-0" />
              {translateText(meta.tags.join(", "))}
            </span>
          )}
          {meta.notes && (
            <span className="w-full rounded-sm border border-yellow-500/30 bg-yellow-500/8 px-2 py-1 text-yellow-600 dark:text-yellow-400">
              {translateText(meta.notes)}
            </span>
          )}
        </div>
      )}

      {/* Simulation summary */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] sm:grid-cols-4">
        {[
          ["Nome", sim.name],
          [
            "Duração",
            formatDuration(sim.duration, sim.timeUnit ?? "seconds"),
          ],
          ["Start tick", sim.startTick?.toString() ?? "0"],
          ["Time unit", sim.timeUnit ?? "—"],
          ["Time step", sim.timeStep?.toString() ?? "—"],
          [
            "Start real time",
            sim.startRealTime
              ? new Date(sim.startRealTime).toLocaleString(intlLocale)
              : "—",
          ],
          [
            "Actor sources",
            sim.actorsDataSources
              ? `${(sim.actorsDataSources as unknown[]).length}`
              : "0",
          ],
        ].map(([label, value]) => (
          <div key={label}>
            <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
              {translateText(label)}
            </p>
            <p className="font-mono text-foreground">{translateText(value)}</p>
          </div>
        ))}
      </div>

      {/* Load button */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={handleLoad}
          disabled={loadingAction}
          variant={activeScenario === name ? "outline" : "default"}
        >
          {loadingAction ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : loaded || activeScenario === name ? (
            <Check className="size-3.5" />
          ) : (
            <FolderOpen className="size-3.5" />
          )}
          {activeScenario === name ? translateText("Cenário activo") : loaded ? translateText("Carregado") : translateText("Carregar cenário")}
        </Button>
        <p className="text-[10px] text-muted-foreground">{translateText("Carrega a config na memória — depois clica Iniciar.")}</p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Scenario row
// ---------------------------------------------------------------------------

function ScenarioRow({
  scenario,
  onLoad,
  activeScenario,
}: {
  scenario: ScenarioSummary
  onLoad: (name: string) => Promise<void>
  activeScenario: string | null
}) {
  const { t: translateText } = useI18n()

  const [expanded, setExpanded] = useState(false)
  const isActive = activeScenario === scenario.name

  return (
    <div
      className={cn(
        "rounded-sm border transition-colors",
        isActive ? "border-primary/40 bg-primary/5" : "border-border bg-card"
      )}
    >
      {/* Header row */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        {expanded ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}

        <div className="flex flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5 min-w-0">
          <span className="font-mono text-[12px] font-semibold text-foreground">
            {translateText(scenario.name)}
          </span>
          {scenario.simulationName && scenario.simulationName !== scenario.name && (
            <span className="text-[11px] text-muted-foreground truncate">
              {translateText(scenario.simulationName)}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {scenario.duration !== null && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Clock className="size-3" />
              {translateText(formatDuration(scenario.duration, scenario.timeUnit))}
            </span>
          )}
          {scenario.hasMetadata && (
            <span className="rounded-sm border border-border bg-muted px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">{translateText("meta")}</span>
          )}
          {isActive && (
            <span className="rounded-sm border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-primary">{translateText("activo")}</span>
          )}
        </div>
      </button>

      {/* Inline detail */}
      {expanded && (
        <div className="border-t border-border px-1 pb-2">
          <ScenarioDetail
            name={scenario.name}
            onLoad={onLoad}
            activeScenario={activeScenario}
          />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function ScenariosPanel({
  onScenarioLoaded,
}: {
  onScenarioLoaded?: (name: string) => void
}) {
  const { t: translateText } = useI18n()

  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([])
  const [scenariosDir, setScenariosDir] = useState<string>("")
  const [activeScenario, setActiveScenario] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")

  const fetchScenarios = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await getScenarios()
      setScenarios(res.scenarios)
      setScenariosDir(res.scenariosDir)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchScenarios()
  }, [fetchScenarios])

  async function handleLoad(name: string) {
    await loadScenario(name)
    setActiveScenario(name)
    onScenarioLoaded?.(name)
  }

  const filtered = search.trim()
    ? scenarios.filter(
        (s) =>
          s.name.toLowerCase().includes(search.toLowerCase()) ||
          s.simulationName?.toLowerCase().includes(search.toLowerCase()) ||
          s.meta?.tags?.some((t) =>
            t.toLowerCase().includes(search.toLowerCase())
          )
      )
    : scenarios

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={translateText("Filtrar cenários…")}
          className="h-7 flex-1 rounded-sm border border-input bg-background px-2.5 text-[11px] text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring/30"
        />
        <button
          onClick={fetchScenarios}
          disabled={loading}
          className="flex items-center gap-1 rounded-sm border border-border px-2 py-1 text-[10px] text-muted-foreground hover:border-ring hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={cn("size-3", loading && "animate-spin")} />{translateText("Atualizar")}</button>
      </div>

      {scenariosDir && (
        <p className="font-mono text-[10px] text-muted-foreground">
          <span className="text-muted-foreground/60">{translateText("dir: ")}</span>
          {translateText(scenariosDir)}
        </p>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-sm border border-destructive/30 bg-destructive/8 px-3 py-2 text-[11px] text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <div>
            <p className="font-semibold">{translateText("Não foi possível listar cenários")}</p>
            <p className="mt-0.5 text-destructive/70">{translateText(error)}</p>
          </div>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <p className="py-4 text-center text-[11px] text-muted-foreground">
          {search ? translateText("Nenhum cenário corresponde ao filtro.") : translateText("Nenhum cenário encontrado no directório configurado.")}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {filtered.map((s) => (
          <ScenarioRow
            key={s.name}
            scenario={s}
            onLoad={handleLoad}
            activeScenario={activeScenario}
          />
        ))}
      </div>
    </div>
  )
}
