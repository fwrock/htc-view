"use client"

import { pcaTrainingSettings } from "@/lib/simedape-pca"

import { selectionRunStamp } from "@/lib/simedape-selection"
import { estimationInputs, roadMetadataError, scenarioRoadFile } from "@/lib/simedape-estimation"
import { SelectionSchedulingControl } from "@/components/simedape/selection-scheduling"
import type { SelectionScheduling } from "@/lib/simedape-api"
import { getSimedapeBackend, getSimedapeBackendDefault } from "@/lib/simedape-api"
import { warpingSettings } from "@/lib/simedape-warping"
import { isTrainingRun, hasTrainingModel } from "@/lib/simedape-training"
import { TrainingRecovery } from "@/components/simedape/training-recovery"
import { RunLogs } from "@/components/simedape/run-logs"

import { useI18n } from "@/components/i18n-provider"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Check, Loader2, Play, RotateCcw, X } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { FolderPicker } from "@/components/locations/folder-picker"
import { LogsPanel } from "@/components/logs-panel"
import { MetricsDashboard } from "@/components/metrics/dashboard"
import { ReferencePicker } from "@/components/simedape/reference-picker"
import { SweepPanel, SweepResults } from "@/components/simedape/sweep-panel"
import { VariantPicker } from "@/components/simedape/variant-picker"
import { ModificationPicker } from "@/components/modifications/modification-picker"
import { ModificationsEditor } from "@/components/modifications/modifications-editor"
import { RunMonitor } from "@/components/simulator/run-monitor"
import { setHtcApiBase, startSimulation } from "@/lib/htc-api"
import { ClusteringReportView } from "@/components/simedape/clustering-report"
import { StageMetricsView } from "@/components/simedape/stage-metrics"
import { ResultsView } from "@/components/simedape/results-view"
import {
  createPartialConfig,
  getPartialReport,
  listEngines,
  type PartialReport,
  type SimEngine,
  getAllScenarios,
  cancelRun,
  getConfigs,
  getRun,
  getRunArtifacts,
  getRunModel,
  getSimedapeHealth,
  getSimulations,
  listRuns,
  saveConfig,
  modelDownloadUrl,
  startRun,
  type Artifact,
  type ModelInfo,
  type DataSource,
  type EstimationMethod,
  type NamedConfig,
  type RunStatus,
  type RunSummary,
  type SimulationEntry,
  type SourceDescription,
  type StageStatus,
  type TrainingResumeOptions,
} from "@/lib/simedape-api"

// ---------------------------------------------------------------------------
// Flow definition
// ---------------------------------------------------------------------------

type RunStep = "train" | "select" | "estimate" | "sweep"
type StepId = "base" | "train" | "select" | "alter" | "partial" | "estimate" | "sweep" | "runs"
const STEPS: { id: StepId; label: string; hint: string }[] = [
  { id: "base", label: "1 · Base", hint: "Escolha a simulação base já executada e os parâmetros." },
  { id: "train", label: "2 · Treinar", hint: "O SimEDaPE aprende o modelo com a base." },
  { id: "select", label: "3 · Seleção", hint: "Define o que deve ser executado na simulação parcial." },
  { id: "alter", label: "Alterações", hint: "Opcional: what-if sobre o cenário base, num arquivo à parte." },
  { id: "partial", label: "4 · Parcial", hint: "O HTC executa só a seleção." },
  { id: "estimate", label: "5 · Estimar", hint: "O modelo estima o resultado completo a partir da parcial." },
  { id: "sweep", label: "Varredura", hint: "Opcional: compara as variações em várias parciais (por % de amostra)." },
  { id: "runs", label: "Execuções", hint: "Histórico, progresso e logs." },
]

/** Each step is one pipeline run. Later stages need the series in memory, so every run reloads the data
 *  (data_load, process_dataset). The TRAINING run is a snapshot: it writes the complete model (clustering, simulation
 *  points, labels, warping paths) into its own directory, and selection / estimation runs read it from there
 *  (`input_dir`) and write their results into their own subdirectory, so nothing is overwritten. */
const LOAD = ["data_load", "process_dataset"]
/** Training stages for the chosen methods. The model file is always built last. */
const trainStagesFor = (methods: ("dtw" | "pca")[]) => [
  ...LOAD, "clustering", "simulation_points",
  ...(methods.includes("dtw") ? ["warping_paths"] : []),
  ...(methods.includes("pca") ? ["pca_train"] : []),
  "model_export",
]
const STEP_STAGES: Record<RunStep, string[]> = {
  train: trainStagesFor(["dtw"]),
  select: [...LOAD, "selection"],
  estimate: [...LOAD, "scenario_metrics", "estimation", "compare"],
  sweep: [...LOAD, "scenario_metrics", "sweep"],
}
/** A run belongs to a step when it contains this stage. */
const STEP_MARKER: Record<RunStep, string[]> = { train: ["clustering"], select: ["selection"], estimate: ["estimation_variants", "estimation", "pca_estimation"], sweep: ["sweep"] }
const hasMarker = (stages: string[] | undefined, s: RunStep) => !!stages?.some((x) => STEP_MARKER[s].includes(x))
const STEP_TAG: Record<RunStep, string> = { train: "treino", select: "seleção", estimate: "estimativa", sweep: "varredura" }
/** Subdirectory (inside the training snapshot) that holds a selection / estimation run's own results. */
const STEP_DIR: Record<"select" | "estimate" | "sweep", string> = { select: "selecao", estimate: "estimativa", sweep: "varredura" }

const STRATEGIES: { id: string; label: string; help: string }[] = [
  { id: "random", label: "Aleatória", help: "Sorteio uniforme das unidades. Linha de base." },
  { id: "cluster_uniform", label: "Cluster uniforme", help: "Mesma cota por cluster." },
  { id: "cluster_weighted", label: "Cluster ponderada", help: "Cota por cluster proporcional ao seu tamanho." },
  { id: "simulation_points", label: "Pontos de simulação", help: "A série mais próxima do centróide de cada cluster." },
  { id: "simulation_points_weighted", label: "Pontos de simulação ponderados", help: "Pontos de simulação, completando pelo peso dos clusters." },
  { id: "greedy_coverage", label: "Cobertura gulosa", help: "Escolhe as unidades que mais cobrem as vias." },
  { id: "greedy_coverage_balanced", label: "Cobertura gulosa balanceada", help: "Cobertura gulosa, equilibrada entre clusters." },
  { id: "centroid_nearest", label: "Mais próximas do centróide", help: "As unidades mais próximas do centróide do seu cluster." },
  { id: "topology_balanced", label: "Crescimento pela topologia, balanceado", help: "Parte da via de cada ponto de simulação, adiciona quem passou por ela e avança para as vias vizinhas até fechar a cota. Cota igual para todos os clusters." },
  { id: "topology_weighted", label: "Crescimento pela topologia, ponderado", help: "Igual ao anterior, mas a cota de cada cluster é proporcional ao seu número de séries." },
]
const TOPOLOGY_STRATEGIES = ["topology_balanced", "topology_weighted"]
const PRESETS: { id: string; label: string; help: string; intervalSize: string; nClusters: string }[] = [
  { id: "fast", label: "Rápido", help: "Teste inicial: poucos clusters, intervalos grandes.", intervalSize: "3600", nClusters: "12" },
  { id: "default", label: "Padrão", help: "Equilíbrio entre tempo e detalhe.", intervalSize: "3600", nClusters: "36" },
  { id: "detailed", label: "Detalhado", help: "Mais clusters e intervalos menores (bem mais lento).", intervalSize: "900", nClusters: "72" },
]

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

interface Form {
  name: string
  configName: string
  scenarioName: string
  dataSource: DataSource
  simulationId: string
  clickhouseTable: string
  samplePeriod: string
  observationMode: "events" | "grouped"
  scenarioDir: string
  streetInfoFile: string
  startTime: string
  endTime: string
  intervalSize: string
  nClusters: string
  strategy: string
  percentage: string
  seed: string
  /** city_map.json / links*.json of the HTC scenario (neighbour links); used by the topology strategies. */
  topologyFile: string
  /** Scenario (<location>:<name>) the base simulation was run from; the partial run starts from it. */
  baseScenario: string
  /** Selection manifest to use in the partial run; empty = the one the Seleção step produced. */
  selectionFile: string
  /** Modification files (names in <scenario>/modifications), applied in this order to the partial and the reference run. */
  modFiles: string[]
  filterableClasses: string
  engineId: string
  methods: EstimationMethod[]
  partial: string
  /** run_id of the training snapshot used by selection and estimation ("" = the latest completed one). */
  snapshot: string
  stages: Record<RunStep, string[]>
  saveAs: string
  /** How the model estimates: DTW warping paths and/or PCA. */
  trainMethods: ("dtw" | "pca")[]
  pcaComponents: string
  pcaCentering: "cluster_mean" | "simulation_point"
  pcaMode: "components" | "variance"
  pcaVariance: string
  randomState: string
  maxIter: string
  clusteringSize: string
  csvSep: string
  precision: "float64" | "float32"
  dtwAlgorithm: "exact" | "fastdtw"
  dtwRadius: string
  dtwWorkers: string
  dtwBatchSize: string
  checkpointData: boolean
  /** Use the PCA model when estimating (only if the snapshot has one). */
  usePca: boolean
  /** Estimation variations to run (keys of the catalog: DTW, PCA, PCA delta). */
  variants: string[]
  /** Complete simulation that the error is measured against (ClickHouse id or CSV folder); empty = the training base. */
  reference: string
  /** Sweep: the partial scenarios (label, location, sample %) and the variations to run on each. */
  sweepScenarios: { label: string; dir: string; percentage: string }[]
  sweepVariants: string[]
}
const BLANK: Form = {
  name: "",
  configName: "",
  scenarioName: "default",
  dataSource: "clickhouse",
  simulationId: "",
  clickhouseTable: "vehicle_link_events",
  samplePeriod: "0",
  observationMode: "events",
  scenarioDir: "",
  streetInfoFile: "",
  startTime: "0",
  endTime: "86400",
  intervalSize: "3600",
  nClusters: "36",
  strategy: "simulation_points_weighted",
  percentage: "10",
  seed: "42",
  topologyFile: "",
  baseScenario: "",
  selectionFile: "",
  modFiles: [],
  filterableClasses: "Person,Car,Bicycle,Motorcycle",
  engineId: "",
  methods: ["avg"],
  partial: "",
  snapshot: "",
  stages: { train: STEP_STAGES.train, select: STEP_STAGES.select, estimate: STEP_STAGES.estimate, sweep: STEP_STAGES.sweep },
  saveAs: "",
  trainMethods: ["dtw"],
  pcaComponents: "5",
  pcaCentering: "cluster_mean",
  pcaMode: "components",
  pcaVariance: "95",
  randomState: "10",
  maxIter: "8",
  clusteringSize: "0",
  csvSep: ";",
  precision: "float64",
  dtwAlgorithm: "exact",
  dtwRadius: "1",
  dtwWorkers: "0",
  dtwBatchSize: "16",
  checkpointData: true,
  usePca: false,
  variants: ["avg", "base", "sample", "wavg"],
  reference: "",
  sweepScenarios: [],
  sweepVariants: ["avg", "base", "sample", "wavg"],
}
const FORM_KEY = "htc.simedape.form.v3"

function configFromForm(f: Form) {
  return {
    scenario_name: f.scenarioName,
    data_source: f.dataSource,
    scenario_dir: f.scenarioDir,
    street_info_file: f.streetInfoFile,
    csv_sep: f.csvSep || ";",
    intervals: { start_time: Number(f.startTime), end_time: Number(f.endTime), interval_size: Number(f.intervalSize), sample_period: Number(f.samplePeriod || 0), ...(getSimedapeBackend() === "scala" ? { observation_mode: f.observationMode } : {}) },
    clustering: { n_clusters: Number(f.nClusters), random_state: Number(f.randomState), max_iter: Number(f.maxIter), clustering_size: Number(f.clusteringSize) },
    clickhouse: { simulation_id: f.simulationId, table: f.clickhouseTable },
    ...(getSimedapeBackend() === "scala" && f.trainMethods.includes("pca") ? { pca_training: pcaTrainingSettings(f.pcaMode, f.pcaComponents, f.pcaVariance, f.pcaCentering) } : {}),
    compact_model: true,
    model_precision: f.precision,
    ...(getSimedapeBackend() === "scala" ? { warping_paths: warpingSettings(f), checkpoint_data: f.checkpointData } : {}),
  }
}
function formFromConfig(base: Form, c: NamedConfig): Form {
  const cfg = c.config
  return {
    ...base,
    configName: c.name,
    scenarioName: cfg.scenario_name,
    dataSource: cfg.data_source,
    simulationId: cfg.clickhouse.simulation_id,
    clickhouseTable: cfg.clickhouse.table,
    samplePeriod: String(cfg.intervals.sample_period ?? 0),
    observationMode: cfg.intervals.observation_mode ?? "events",
    scenarioDir: cfg.scenario_dir,
    streetInfoFile: cfg.street_info_file,
    startTime: String(cfg.intervals.start_time),
    endTime: String(cfg.intervals.end_time),
    intervalSize: String(cfg.intervals.interval_size),
    nClusters: String(cfg.clustering.n_clusters),
    randomState: String(cfg.clustering.random_state ?? 10),
    maxIter: String(cfg.clustering.max_iter ?? 8),
    clusteringSize: String(cfg.clustering.clustering_size ?? 0),
    csvSep: cfg.csv_sep || ";",
    dtwAlgorithm: cfg.warping_paths?.algorithm ?? "exact",
    dtwRadius: String(cfg.warping_paths?.radius ?? 1),
    dtwWorkers: String(cfg.warping_paths?.n_jobs ?? 0),
    dtwBatchSize: String(cfg.warping_paths?.batch_size ?? 16),
    checkpointData: cfg.checkpoint_data ?? true,
    pcaCentering: cfg.pca_training?.centering ?? "cluster_mean",
    pcaMode: cfg.pca_training?.selection_mode ?? (cfg.pca_training?.variance_threshold !== undefined ? "variance" : "components"),
    pcaComponents: String(cfg.pca_training?.n_components ?? 5),
    pcaVariance: String((cfg.pca_training?.variance_threshold ?? 0.95) * 100),
  }
}
const stamp = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}
const dirName = (dir: string | undefined) => (dir ?? "").replace(/\/+$/, "").split("/").pop() ?? ""
/** Does this snapshot's base match what the form currently describes? (selection/estimation must use the same base) */
function sameBase(run: RunSummary | null, f: Form): boolean {
  const src = run?.meta.data_source
  if (!src) return true
  if (src.type === "clickhouse") return f.dataSource === "clickhouse" && src.simulation_id === f.simulationId
  if (src.type === "csv") return f.dataSource === "csv" && src.scenario_dir === f.scenarioDir
  return true
}

/** Everything the training needs, with its state; `ok` items are satisfied. Street info is needed later (metrics), not to cluster. */
function trainChecklist(f: Form): { label: string; ok: boolean; hint: string; blocks: boolean }[] {
  const fine = Number(f.intervalSize) > 0 && Number(f.endTime) > Number(f.startTime)
  return [
    { label: "Simulação base", ok: f.dataSource === "clickhouse" ? !!f.simulationId.trim() : !!f.scenarioDir.trim(), hint: "Escolha a base na etapa 1.", blocks: true },
    { label: "Janela e intervalo", ok: fine, hint: "Fim maior que o início e intervalo positivo.", blocks: true },
    { label: "Número de clusters", ok: Number(f.nClusters) >= 2, hint: "Pelo menos 2.", blocks: true },
    { label: "Método do modelo", ok: f.trainMethods.length > 0, hint: "Marque DTW e/ou PCA.", blocks: true },
    { label: "Informações das vias", ok: !!f.streetInfoFile.trim(), hint: "Não é necessário para agrupar, mas as etapas de métricas e estimativa pedem este CSV (link;length;capacity;freespeed). Vale também para ClickHouse.", blocks: false },
  ]
}

/** What is still missing before a run can start (empty = ready). */
function missingBase(f: Form): string[] {
  const out: string[] = []
  if (f.dataSource === "clickhouse" && !f.simulationId.trim()) out.push("a simulação base (simulation_id)")
  if (f.dataSource === "csv" && !f.scenarioDir.trim()) out.push("a pasta CSV da base")
  if (!(Number(f.endTime) > Number(f.startTime))) out.push("fim maior que o início")
  if (!(Number(f.intervalSize) > 0)) out.push("um intervalo positivo")
  if (!(Number(f.nClusters) >= 2)) out.push("pelo menos 2 clusters")
  return out
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

const input = "h-8 w-full rounded-sm border border-input bg-background px-2 text-xs focus:border-ring focus:ring-1 focus:ring-ring/30 focus:outline-none"
const isActive = (s: RunStatus | undefined) => s === "queued" || s === "running"
const fmtTs = (ts: number | null | undefined, intlLocale: string) => (ts ? new Date(ts * 1000).toLocaleString(intlLocale) : "—")
const fmtSeconds = (s: number | null | undefined) => (s == null ? "—" : s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`)

const STATUS_CLASS: Record<RunStatus, string> = {
  queued: "border-border bg-muted text-muted-foreground",
  running: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  completed: "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400",
  failed: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
  cancelled: "border-border bg-muted text-muted-foreground",
}
const STATUS_LABEL: Record<RunStatus, string> = { queued: "Na fila", running: "Em execução", completed: "Concluído", failed: "Falhou", cancelled: "Cancelado" }
const STAGE_COLOR: Record<StageStatus, string> = {
  pending: "text-muted-foreground",
  running: "text-blue-600 dark:text-blue-400",
  completed: "text-green-600 dark:text-green-400",
  failed: "text-red-600 dark:text-red-400",
}

function Badge({ status }: { status: RunStatus }) {
  const { t: translateText } = useI18n()

  return <span className={cn("rounded-sm border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest", STATUS_CLASS[status])}>{translateText(STATUS_LABEL[status])}</span>
}

function Field({ label, hint, children, wide }: { label: string; hint?: string; children: React.ReactNode; wide?: boolean }) {
  const { t: translateText } = useI18n()

  return (
    <label className={cn("flex flex-col gap-1 text-xs", wide && "sm:col-span-2")}>
      <span className="font-medium">{translateText(label)}</span>
      {children}
      {hint && <span className="text-[11px] text-muted-foreground">{translateText(hint)}</span>}
    </label>
  )
}

function describeSource(src: SourceDescription | undefined) {
  if (!src) return "—"
  if (src.type === "clickhouse") return `ClickHouse ${src.host}:${src.port}/${src.database}${src.simulation_id ? ` · ${src.simulation_id}` : ""}`
  if (src.type === "csv") return `CSV ${src.scenario_dir}`
  return `HTC ${src.scenario}`
}

function RunCard({ run, onCancel }: { run: RunSummary; onCancel?: () => void }) {
  const { t: translateText, intlLocale } = useI18n()

  const p = run.progress
  return (
    <div className="flex flex-col gap-2 rounded-sm border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge status={run.status} />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">{translateText(run.name || run.run_id)}</span>
        <span className="text-[10px] text-muted-foreground">{translateText(fmtTs(run.created_at, intlLocale))}</span>
        {run.status === "queued" && onCancel && <Button size="xs" variant="destructive" onClick={onCancel}><X className="size-3" />{translateText(" Cancelar")}</Button>}
      </div>
      {p && p.total > 0 && (
        <>
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-green-500 transition-all" style={{ width: `${p.percent}%` }} /></div>
            <span className="font-mono text-[10px] text-muted-foreground">{translateText(p.completed)}/{translateText(p.total)}</span>
          </div>
          <ul className="flex flex-col gap-1">
            {p.stages.map((s) => (
              <li key={s.name} className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border px-2 py-1 text-[11px]">
                <span className={cn("font-mono font-semibold", STAGE_COLOR[s.status])}>{translateText(s.name)}</span>
                <span className="text-muted-foreground">{translateText(fmtSeconds(s.elapsed))} · {translateText(s.status)}</span>
                {s.metrics && <StageMetricsView metrics={s.metrics} runId={run.run_id} />}
                {s.error && <span className="w-full text-[10px] text-destructive">{translateText(s.error)}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      {run.persistence_error && <p className="text-[11px] text-amber-600">{run.persistence_error}</p>}
      {run.error && <p className="text-[11px] text-destructive">{translateText("Erro: ")}{translateText(run.error)}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function bytes(n: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"]
  let x = n
  let i = 0
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024
    i++
  }
  return `${x.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/** Result of a training run: what the model file contains, its size, and the cluster distribution. */
function ModelResult({ model, runId, runName }: { model: ModelInfo; runId: string; runName?: string }) {
  const { t: translateText, intlLocale } = useI18n()

  const sm = model.summary
  const parts = Object.entries(model.components).filter(([k]) => k !== "manifest")
  const ratio = model.total_raw_bytes > 0 ? model.total_raw_bytes / Math.max(1, model.file_bytes) : 0
  const clusters = sm.cluster_sizes.map((n, i) => ({ label: `cluster ${i}`, value: n })).sort((a, b) => b.value - a.value)
  const max = Math.max(1, ...clusters.map((c) => c.value))
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium">{translateText("Resultado do treino")}{runName ? translateText(" · {0}", { 0: runName }) : translateText("")}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Séries", sm.n_series.toLocaleString(intlLocale), `${sm.series_length} pontos cada`],
          ["Clusters", String(sm.n_clusters), `${sm.simulation_points} pontos de simulação`],
          ["Arquivo do modelo", bytes(model.file_bytes), ratio > 1 ? `${ratio.toFixed(1)}× menor que o conteúdo sem compressão` : ""],
          ["Métodos", sm.methods.map((m) => m.toUpperCase()).join(" + ") || "—", sm.dtw ? `${sm.dtw.paths.toLocaleString(intlLocale)} caminhos DTW (média ${sm.dtw.mean_path_length} passos)` : sm.pca ? (sm.pca.centering === "simulation_point" ? translateText("{0} componentes, {1}% de energia residual", { 0: sm.pca.n_components, 1: sm.pca.explained_variance_pct_mean ?? "—" }) : `${sm.pca.n_components} componentes, ${sm.pca.explained_variance_pct_mean ?? "—"}% da variância`) : ""],
        ].map(([label, value, sub]) => (
          <div key={label} className="rounded-sm border border-border p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{translateText(label)}</p>
            <p className="text-lg font-semibold">{translateText(value)}</p>
            {sub && <p className="text-[10px] text-muted-foreground">{translateText(sub)}</p>}
          </div>
        ))}
      </div>
      {sm.dtw?.settings && <p className="text-xs text-muted-foreground">
        {translateText("Algoritmo DTW")}: {translateText(sm.dtw.settings.algorithm === "fastdtw" ? "FastDTW (aproximado)" : "DTW exato (janela de 10%)")}
        {sm.dtw.settings.algorithm === "fastdtw" && ` · ${translateText("Raio do FastDTW")}: ${sm.dtw.settings.radius ?? 1}`}
      </p>}
      {!!sm.pca?.per_cluster?.length && <div className="overflow-x-auto rounded-sm border border-border p-3">
        <p className="mb-2 text-xs font-medium">{translateText("PCA por cluster")} · {translateText(sm.pca.centering === "simulation_point" ? "Ponto de simulação do treino (experimental)" : "Média do cluster (padrão)")}{sm.pca.selection?.variance_threshold !== undefined && ` · ${translateText(sm.pca.centering === "simulation_point" ? "Meta de energia residual por cluster (%)" : "Meta de variância por cluster (%)")}: ${sm.pca.selection.variance_threshold * 100}%`}</p>
        <table className="w-full text-left text-xs"><thead><tr><th className="py-1">{translateText("Cluster")}</th><th>{translateText("Componentes selecionados")}</th><th>{translateText(sm.pca.centering === "simulation_point" ? "Energia residual retida (%)" : "Variância explicada (%)")}</th></tr></thead>
          <tbody>{sm.pca.per_cluster.map(row => <tr key={row.cluster}><td className="py-1">{row.cluster + 1}</td><td>{row.n_components}</td><td>{row.explained_variance_pct === null ? "—" : row.explained_variance_pct.toLocaleString(intlLocale, { maximumFractionDigits: 2 })}</td></tr>)}</tbody>
        </table>
        <p className="mt-1 text-[10px] text-muted-foreground">{translateText(sm.pca.centering === "simulation_point" ? "Sem energia residual, o percentual retido é indefinido." : "Clusters sem variação não têm percentual de variância definido.")}</p>
      </div>}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-sm border border-border p-3">
          <p className="mb-2 text-xs font-medium">{translateText("Séries por cluster")}</p>
          <ul className="flex flex-col gap-1">
            {clusters.slice(0, 15).map((c) => (
              <li key={c.label} className="flex items-center gap-2 text-[11px]">
                <span className="w-16 shrink-0 text-muted-foreground">{translateText(c.label)}</span>
                <span className="h-3 rounded-sm bg-primary/70" style={{ width: `${(c.value / max) * 100}%`, minWidth: 2 }} />
                <span className="font-mono">{translateText(c.value.toLocaleString(intlLocale))}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-sm border border-border p-3">
          <p className="mb-2 text-xs font-medium">{translateText("O que há no arquivo")}</p>
          <table className="w-full text-[11px]">
            <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-3">{translateText("Parte")}</th><th className="pr-3 text-right">{translateText("Itens")}</th><th className="pr-3 text-right">{translateText("Sem compressão")}</th><th className="text-right">{translateText("No arquivo")}</th></tr></thead>
            <tbody>
              {parts.map(([k, c]) => (
                <tr key={k} className="border-t border-border"><td className="py-1 pr-3 font-medium">{translateText(k)}</td><td className="pr-3 text-right font-mono">{translateText(c.members)}</td><td className="pr-3 text-right font-mono">{translateText(bytes(c.raw_bytes))}</td><td className="text-right font-mono">{translateText(bytes(c.stored_bytes))}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <a href={modelDownloadUrl(runId)} className="inline-flex h-8 items-center rounded-sm border border-border px-3 text-xs hover:bg-muted">{translateText("Baixar ")}{translateText(model.file)}</a>
        <span className="text-[11px] text-muted-foreground">{translateText("ZIP comum (")}<code className="font-mono">unzip -l</code>{translateText(" lista o conteúdo) com arrays ")}<code className="font-mono">.npy</code>{translateText(" e um ")}<code className="font-mono">manifest.json</code>.</span>
      </div>
    </div>
  )
}

export default function SimedapePage() {
  const { t: translateText, intlLocale } = useI18n()

  const [step, setStepState] = useState<StepId>("base")
  const [form, setForm] = useState<Form>(BLANK)
  const [hydrated, setHydrated] = useState(false)
  const [backend, setBackend] = useState<"python" | "scala">("scala")
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [online, setOnline] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [configs, setConfigs] = useState<NamedConfig[]>([])
  const [simulations, setSimulations] = useState<SimulationEntry[]>([])
  const [simsError, setSimsError] = useState<string | null>(null)
  const [picker, setPicker] = useState(false)
  const [mapOptions, setMapOptions] = useState<{ ref: string; label: string }[]>([])
  const [starting, setStarting] = useState<string | null>(null)
  const [selectedRun, setSelectedRun] = useState<string | null>(null)
  const [logs, setLogs] = useState<{ id: string; text: string } | null>(null)
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [trainModel, setTrainModel] = useState<ModelInfo | null>(null)
  const [snapshotModel, setSnapshotModel] = useState<ModelInfo | null>(null)
  const [trainLogs, setTrainLogs] = useState<{ id: string; text: string } | null>(null)
  const recoveryOptions = useMemo<TrainingResumeOptions | null>(() => {
    try {
      return { methods: form.trainMethods, warping_paths: warpingSettings(form), pca_training: form.trainMethods.includes("pca") ? pcaTrainingSettings(form.pcaMode, form.pcaComponents, form.pcaVariance, form.pcaCentering) : undefined,
        model_precision: form.precision, clustering: { n_clusters: Number(form.nClusters), max_iter: Number(form.maxIter), random_state: Number(form.randomState), clustering_size: Number(form.clusteringSize) } }
    } catch { return null }
  }, [form.trainMethods, form.dtwAlgorithm, form.dtwRadius, form.dtwWorkers, form.dtwBatchSize, form.pcaComponents, form.pcaMode, form.pcaVariance, form.pcaCentering, form.precision, form.nClusters, form.maxIter, form.randomState, form.clusteringSize])

  // --- persistence and URL ---
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const url = new URL(window.location.href)
      if (!url.searchParams.has("backend")) {
        const preferred = await getSimedapeBackendDefault().catch(() => getSimedapeBackend())
        if (cancelled) return
        url.searchParams.set("backend", preferred)
        window.history.replaceState(null, "", url)
      }
      const selected = getSimedapeBackend()
      setBackend(selected)
      try {
        // Preserve existing Python forms while keeping Scala snapshots separate.
        const saved = localStorage.getItem(`${FORM_KEY}.${selected}`)
          ?? (selected === "python" ? localStorage.getItem(FORM_KEY) : null)
        if (saved) setForm({ ...BLANK, ...JSON.parse(saved), stages: { ...BLANK.stages, ...(JSON.parse(saved).stages ?? {}) } })
      } catch { /* storage unavailable */ }
      const q = url.searchParams.get("step")
      if (q && STEPS.some((s) => s.id === q)) setStepState(q as StepId)
      setHydrated(true)
    })()
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(`${FORM_KEY}.${getSimedapeBackend()}`, JSON.stringify(form))
    } catch {
      /* storage unavailable */
    }
  }, [form, hydrated])
  const setStep = useCallback((s: StepId) => {
    setStepState(s)
    const url = new URL(window.location.href)
    url.searchParams.set("step", s)
    window.history.replaceState(null, "", url)
  }, [])
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))

  const chooseSimulation = (id: string) => {
    const selected = simulations.find((entry) => entry.id === id)
    const cfg = selected?.recommended_config
    setForm((f) => ({ ...f, simulationId:id, ...(cfg ? {
      configName:"", scenarioName:cfg.scenario_name ?? f.scenarioName,
      streetInfoFile:scenarioRoadFile(f.streetInfoFile, f.simulationId, id, cfg.street_info_file),
      clickhouseTable:cfg.clickhouse?.table ?? "vehicle_link_events",
      startTime:String(cfg.intervals?.start_time ?? 0), endTime:String(cfg.intervals?.end_time ?? 86400),
      intervalSize:String(cfg.intervals?.interval_size ?? 3600), samplePeriod:String(cfg.intervals?.sample_period ?? 0), observationMode:cfg.intervals?.observation_mode ?? "events",
      nClusters:String(cfg.clustering?.n_clusters ?? f.nClusters), clusteringSize:String(cfg.clustering?.clustering_size ?? 0),
      baseScenario:selected?.scenario_key ? `default:${selected.scenario_key}` : f.baseScenario,
    } : {}) }))
  }

  // --- data ---
  const fetchRuns = useCallback(async () => {
    try {
      const list = (await listRuns()).filter((r) => !["htc_native", "htc_osm_preview", "htc_osm_publish"].includes(r.meta.workflow ?? "")).sort((a, b) => b.created_at - a.created_at)
      setRuns(list)
      setOnline(true)
      setError(null)
      setSelectedRun((cur) => (cur && list.some((r) => r.run_id === cur) ? cur : (list[0]?.run_id ?? null)))
    } catch (e) {
      setOnline(false)
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => {
    if (!hydrated) return
    void fetchRuns()
    getSimedapeHealth().catch(() => setOnline(false))
    getConfigs().then(setConfigs).catch(() => setConfigs([]))
  }, [fetchRuns, hydrated])
  const anyActive = runs.some((r) => isActive(r.status))
  const [selectionScheduling, setSelectionScheduling] = useState<SelectionScheduling | null>(null)
  useEffect(() => {
    if (!hydrated) return
    const t = setInterval(() => void fetchRuns(), anyActive ? 2500 : 10000)
    return () => clearInterval(t)
  }, [anyActive, fetchRuns, hydrated])
  const loadSimulations = useCallback(() => {
    getSimulations().then((r) => { setSimulations(r.simulations); setSimsError(null) }).catch((e) => { setSimulations([]); setSimsError((e as Error).message) })
  }, [])
  useEffect(() => {
    if (hydrated && form.dataSource === "clickhouse") loadSimulations()
  }, [form.dataSource, loadSimulations, hydrated])

  const detail = runs.find((r) => r.run_id === selectedRun) ?? null
  useEffect(() => {
    if (step !== "runs" || !selectedRun) return
    const load = () => getRun(selectedRun).then((r) => setLogs({ id: selectedRun, text: r.logs ?? "" })).catch(() => {})
    load()
    getRunArtifacts(selectedRun).then((a) => setArtifacts(a.artifacts)).catch(() => setArtifacts([]))
    if (!isActive(detail?.status)) return
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [step, selectedRun, detail?.status])

  const trimDir = (d: string | undefined) => (d ?? "").replace(/\/+$/, "")

  /** Snapshots: completed training runs. Each one holds the complete model in its own directory. */
  const snapshots = useMemo(
    () => runs.filter((r) => r.status === "completed" && hasTrainingModel(r) && r.meta.output_dir),
    [runs]
  )
  const snapshot = useMemo(
    () => snapshots.find((r) => r.run_id === form.snapshot) ?? snapshots.find((r) => r.meta.scenario_name === form.scenarioName) ?? snapshots[0] ?? null,
    [snapshots, form.snapshot, form.scenarioName]
  )

  // Scenarios listed in HTC Locations, offered as the map (topology) source for the topology strategies.
  const wantsMap = (step === "select" && TOPOLOGY_STRATEGIES.includes(form.strategy)) || step === "partial"
  const loadMapOptions = useCallback(() => {
    getAllScenarios()
      .then((r) => setMapOptions(r.scenarios.map((x) => ({ ref: x.ref, label: `${x.title || x.name} · ${x.location_label}` }))))
      .catch(() => setMapOptions([]))
  }, [])
  useEffect(() => {
    if (wantsMap) loadMapOptions()
  }, [wantsMap, loadMapOptions])

  // Partial step: engines to run on, the launch itself and the filter report.
  const [engines, setEngines] = useState<SimEngine[]>([])
  const [partialRun, setPartialRun] = useState<{ engineUrl: string; selection: string | null; configFile: string; note: string | null; kind: "partial" | "modified"; modifications: string[] } | null>(null)
  const [partialReport, setPartialReport] = useState<PartialReport | null>(null)
  const [partialError, setPartialError] = useState<string | null>(null)
  const [partialBusy, setPartialBusy] = useState(false)
  const [partialSimId, setPartialSimId] = useState<string | null>(null)
  const [partialTab, setPartialTab] = useState<"progress" | "metrics" | "logs" | "filter">("progress")
  useEffect(() => {
    if (step !== "partial") return
    listEngines().then((r) => setEngines(r.engines)).catch(() => setEngines([]))
  }, [step])

  // What the snapshot in use contains (which estimation methods exist, sizes).
  const snapshotId = snapshot?.run_id
  useEffect(() => {
    if (!snapshotId) {
      setSnapshotModel(null)
      return
    }
    let cancelled = false
    getRunModel(snapshotId).then((m) => !cancelled && setSnapshotModel(m)).catch(() => !cancelled && setSnapshotModel(null))
    return () => {
      cancelled = true
    }
  }, [snapshotId])

  /** Latest run of a step. Training: this scenario's latest. Selection / estimation: the latest one that used the selected snapshot. */
  const runFor = useCallback((s: RunStep) => {
    if (s === "train") {
      const mine = runs.filter(isTrainingRun)
      return mine.find((r) => r.meta.scenario_name === form.scenarioName) ?? mine[0] ?? null
    }
    if (!snapshot) return null
    const dir = trimDir(snapshot.meta.output_dir)
    return runs.find((r) => hasMarker(r.meta.stages, s) && trimDir(r.meta.output_dir).startsWith(dir + "/")) ?? null
  }, [runs, form.scenarioName, snapshot])

  async function start(s: RunStep) {
    setError(null)
    setStarting(s)
    try {
      if (s === "estimate" && !form.partial.trim()) throw new Error("Informe a simulação parcial.")
      if (s === "estimate" && form.variants.length === 0) throw new Error("Escolha ao menos uma variação.")
      if ((s === "estimate" || s === "sweep") && roadMetadataError(form.streetInfoFile)) throw new Error(roadMetadataError(form.streetInfoFile)!)
      const params = configFromForm(form)
      const config: Record<string, unknown> = { ...params }
      const id = s === "select" ? selectionRunStamp(stamp()) : stamp()
      const base = form.name.trim() || form.scenarioName
      let name: string
      if (s === "train") {
        // A new snapshot: its own directory, nothing shared with earlier trainings.
        config.output_dir = `output/${getSimedapeBackend()}/${form.scenarioName}/t${id}/`
        config.input_dir = ""
        name = `${base} · treino · ${form.nClusters} clusters · intervalo ${form.intervalSize}`
      } else {
        if (!snapshot) throw new Error("Treine o modelo antes (etapa 2).")
        if (!sameBase(snapshot, form)) throw new Error("A base atual é diferente da base do snapshot escolhido. Escolha o snapshot da mesma base ou volte a ela na etapa 1.")
        const dir = trimDir(snapshot.meta.output_dir)
        config.input_dir = `${dir}/`                        // the trained model is read from the snapshot…
        config.output_dir = `${dir}/${STEP_DIR[s]}-${id}/`  // …and this run writes only into its own subdirectory
        name = `${base} · ${STEP_TAG[s]} ← ${dirName(dir)}`
      }
      const stage_params: Record<string, Record<string, unknown>> = {}
      const stages = s === "train" ? trainStagesFor(form.trainMethods) : s === "sweep" ? STEP_STAGES.sweep : estimateStages
      if (stages.includes("pca_train")) stage_params.pca_train = getSimedapeBackend() === "scala" ? { ...pcaTrainingSettings(form.pcaMode, form.pcaComponents, form.pcaVariance, form.pcaCentering) } : { n_components: Number(form.pcaComponents) || 5 }
      if (stages.includes("warping_paths") && backend === "scala") stage_params.warping_paths = { ...warpingSettings(form) }
      if (form.stages[s].includes("selection")) stage_params.selection = { strategy: form.strategy, percentage: Number(form.percentage), seed: Number(form.seed), ...(TOPOLOGY_STRATEGIES.includes(form.strategy) ? { topology_file: form.topologyFile.trim() } : {}) }
      if ((s === "estimate" || s === "sweep") && form.reference.trim()) stage_params.scenario_metrics = { reference_dir: form.reference.trim() }
      if (s === "estimate") {
        stage_params.estimation_variants = { variants: form.variants, second_scenario_dir: form.partial.trim() }
        stage_params.compare = { estimated_files: form.variants.map((k) => `result_${k}`), generate_plots: form.variants.length <= 12 }
      }
      if (s === "sweep") {
        const rows = form.sweepScenarios.filter((r) => r.dir.trim())
        if (rows.length === 0) throw new Error("Informe ao menos uma parcial na varredura.")
        stage_params.sweep = {
          real_file: "new_simulation",
          scenarios: rows.map((r, i) => ({ label: r.label.trim() || `${r.percentage || "?"}%`, dir: r.dir.trim(), percentage: Number(r.percentage) || 100, order: i })),
          variants: form.sweepVariants,
          generate_plots: false,
        }
      }
      if (form.saveAs.trim()) await saveConfig(form.saveAs.trim(), params)   // saved parameters never include run directories
      const requestedStages = s === "select" ? (backend === "scala" && form.strategy !== "centroid_nearest" ? ["selection"] : form.stages.select) : stages
      await startRun({ name, stages: requestedStages, config, stage_params })
      await fetchRuns()
      getConfigs().then(setConfigs).catch(() => {})
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setStarting(null)
    }
  }
  async function cancel(id: string) {
    try {
      await cancelRun(id)
      await fetchRuns()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const missing = missingBase(form)
  const trainRun = runFor("train")
  const trainRunId = trainRun?.run_id
  const trainStatus = trainRun?.status
  useEffect(() => {
    if (!trainRunId || trainStatus !== "completed") {
      setTrainModel(null)
      return
    }
    let cancelled = false
    getRunModel(trainRunId).then((m) => !cancelled && setTrainModel(m)).catch(() => !cancelled && setTrainModel(null))
    return () => {
      cancelled = true
    }
  }, [trainRunId, trainStatus])
  useEffect(() => {
    if (step !== "train" || !trainRunId) return
    const load = () => getRun(trainRunId).then((r) => setTrainLogs({ id: trainRunId, text: r.logs ?? "" })).catch(() => {})
    load()
    if (!isActive(trainStatus)) return
    const t = setInterval(load, 2500)
    return () => clearInterval(t)
  }, [step, trainRunId, trainStatus])
  const estimateStages = [...LOAD, "scenario_metrics", "estimation_variants", "compare"]
  const selectRun = runFor("select")
  const autoSelection = selectRun?.status === "completed" && selectRun.meta.output_dir ? `${trimDir(selectRun.meta.output_dir)}/selection.json` : ""
  const selectionRuns = useMemo(() => {
    if (!snapshot?.meta.output_dir) return []
    const dir = trimDir(snapshot.meta.output_dir) + "/"
    return runs
      .filter((r) => r.status === "completed" && r.meta.stages?.includes("selection") && r.meta.output_dir && trimDir(r.meta.output_dir).startsWith(dir))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  }, [runs, snapshot])
  const selectionInUse = form.selectionFile.trim() || autoSelection
  const selectionIsListed = selectionRuns.some((r) => `${trimDir(r.meta.output_dir)}/selection.json` === selectionInUse)
  const [selectionManual, setSelectionManual] = useState(false)

  useEffect(() => {
    if (!partialRun?.selection || partialReport) return
    const selection = partialRun.selection
    const t = setInterval(() => {
      getPartialReport(selection).then(setPartialReport).catch(() => {})
    }, 3000)
    return () => clearInterval(t)
  }, [partialRun, partialReport])

  const setModFiles = useCallback((files: string[]) => set("modFiles", files), [set])
  const [modRefresh, setModRefresh] = useState(0)

  /** kind "partial": selection (+ the chosen modifications). kind "reference": the full run of the altered scenario (no selection). */
  async function startPartial(kind: "partial" | "reference" = "partial") {
    setPartialBusy(true)
    setPartialError(null)
    setPartialReport(null)
    setPartialRun(null)
    try {
      const engine = engines.find((e) => e.id === form.engineId)
      if (!engine) throw new Error("Escolha o engine em que a parcial vai rodar.")
      if (kind === "reference" && form.modFiles.length === 0) throw new Error("Escolha ao menos um arquivo de modificações: sem eles a referência é a própria base.")
      const cfg = await createPartialConfig({
        ref: form.baseScenario,
        ...(kind === "partial" ? { selection_file: selectionInUse, filterable_classes: form.filterableClasses.split(",").map((x) => x.trim()).filter(Boolean) } : {}),
        modification_files: form.modFiles,
      })
      if (cfg.problems.length) throw new Error(`simulation.partial.json inválido: ${cfg.problems.join("; ")}`)
      setHtcApiBase(engine.url)
      const started = await startSimulation({ configFile: cfg.engine_path })
      setPartialRun({ engineUrl: engine.url, selection: cfg.partial?.selectionFile ?? null, configFile: cfg.engine_path, note: cfg.note, kind: cfg.kind, modifications: form.modFiles })
      const reportId = started.simulationId || cfg.simulation_id
      if (form.dataSource === "clickhouse") set(kind === "reference" ? "reference" : "partial", reportId)
      setPartialSimId(reportId)
    } catch (e) {
      setPartialError((e as Error).message)
    } finally {
      setPartialBusy(false)
    }
  }
  const estimateRun = runFor("estimate")
  const previousEstimateInputs = estimationInputs(estimateRun)
  const sweepRun = runFor("sweep")
  const stepRun: Record<string, RunSummary | null> = { train: trainRun, select: selectRun, estimate: estimateRun, sweep: sweepRun }
  const intervals = Number(form.intervalSize) > 0 ? Math.max(0, Math.floor((Number(form.endTime) - Number(form.startTime)) / Number(form.intervalSize))) : 0

  const baseMismatch = snapshot !== null && !sameBase(snapshot, form)
  /** Which trained model (snapshot) selection and estimation use. */
  const snapshotField = (
    <div className="flex flex-col gap-1">
      <Field label={translateText("Modelo treinado (snapshot)")} hint={translateText("Cada treino fica em uma pasta própria; esta etapa lê o modelo de lá e grava só dentro dela, sem sobrescrever nada.")}>
        <select className={input} value={snapshot?.run_id ?? ""} onChange={(e) => set("snapshot", e.target.value)} disabled={snapshots.length === 0}>
          {snapshots.length === 0 && <option value="">{translateText("Nenhum treino concluído")}</option>}
          {snapshots.map((r) => <option key={r.run_id} value={r.run_id}>{translateText(r.name)} · {translateText(fmtTs(r.created_at, intlLocale))}</option>)}
        </select>
      </Field>
      {snapshot && <p className="font-mono text-[10px] text-muted-foreground">{translateText(snapshot.meta.output_dir)}{translateText(" · base: ")}{translateText(describeSource(snapshot.meta.data_source))}</p>}
      {baseMismatch && <p className="text-[11px] text-yellow-700 dark:text-yellow-400">{translateText("A base escolhida na etapa 1 é diferente da base deste snapshot. Escolha outro snapshot ou ajuste a base.")}</p>}
    </div>
  )
  const snapshotBlocker = !snapshot ? "Treine o modelo antes (etapa 2)." : baseMismatch ? "A base atual difere da base do snapshot." : null

  /** The pipeline stages this step runs, read-only (they follow from the options chosen above). */
  const stageChecklist = (s: RunStep) => (
    <p className="text-[11px] text-muted-foreground" title={translateText("Cada etapa da tela roda uma sequência de estágios do pipeline SimEDaPE.")}>{translateText("Estágios que serão executados: ")}<span className="font-mono">{translateText((s === "select" && backend === "scala" && form.strategy !== "centroid_nearest" ? ["selection"] : s === "estimate" ? estimateStages : STEP_STAGES[s]).join(" → "))}</span>
    </p>
  )

  const runPanel = (s: RunStep, cta: string, disabledReason: string | null, extra?: React.ReactNode) => {
    const run = stepRun[s]
    const canQueueSelection = s === "select" && backend === "scala" && form.strategy !== "centroid_nearest" && selectionScheduling !== null
    const blockedByActive = anyActive && !canQueueSelection
    return (
      <div className="flex flex-col gap-3">
        {s === "select" ? translateText(stageChecklist(s)) : null}
        {translateText(extra)}
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={!!disabledReason || starting !== null || blockedByActive} onClick={() => void start(s)}>
            {starting === s ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} {translateText(cta)}
          </Button>
          {disabledReason && <span className="text-[11px] text-muted-foreground">{translateText(disabledReason)}</span>}
          {!disabledReason && blockedByActive && <span className="text-[11px] text-muted-foreground">{translateText("Aguarde a execução em andamento terminar.")}</span>}
        </div>
        {anyActive && runs.filter((active) => isActive(active.status) && active.run_id !== run?.run_id).map((active) => (
          <RunCard key={active.run_id} run={active} onCancel={() => void cancel(active.run_id)} />
        ))}
        {run ? <RunCard run={run} onCancel={() => void cancel(run.run_id)} /> : <p className="text-xs text-muted-foreground">{translateText("Esta etapa ainda não foi executada para este cenário.")}</p>}
        {run && (s === "estimate" || s === "sweep") && <RunLogs key={run.run_id} runId={run.run_id} status={run.status} />}
      </div>
    )
  }

  const partialResultsField = (
    <Field
      label={form.dataSource === "clickhouse" ? translateText("Resultados da parcial (simulation_id)") : translateText("Resultados da parcial (pasta)")}
      hint={
        partialSimId ? form.dataSource === "clickhouse" ? translateText("Preenchido com o id desta parcial ({0}). Confira que o engine grava no ClickHouse com esse id.", { 0: partialSimId }) : translateText("A parcial grava os resultados sob o id {0}; informe a pasta onde o relatório (CSV) dela foi gravado.", { 0: partialSimId }) : translateText("Onde estão os resultados (eventos por via) da simulação parcial. A etapa Estimar lê esta simulação para estimar o cenário completo. Com a parcial iniciada acima, o id é preenchido sozinho (ClickHouse); senão, escolha ou digite.")
      }
    >
      <>
        <input aria-label={form.dataSource === "clickhouse" ? translateText("Resultados da parcial (simulation_id)") : translateText("Resultados da parcial (pasta)")} className={cn(input, "font-mono")} list={form.dataSource === "clickhouse" ? "partial-simulations" : undefined} placeholder={form.dataSource === "clickhouse" ? translateText("Escolha da lista ou digite o simulation_id") : translateText("/caminho/da/parcial")} value={form.partial} onChange={(e) => set("partial", e.target.value)} />
        {form.dataSource === "clickhouse" && (
          <datalist id="partial-simulations">
            {simulations.filter((s) => s.id !== form.simulationId).map((s) => <option key={s.id} value={s.id} />)}
          </datalist>
        )}
      </>
    </Field>
  )

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-lg font-semibold">{translateText("SimEDaPE")}</h1>
          <p className="text-xs text-muted-foreground">{translateText("Estimação do resultado completo a partir de uma simulação parcial.")}</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <label className="flex items-center gap-2">
            <span>SimEDaPE backend</span>
            <select aria-label="SimEDaPE backend" className="rounded-sm border border-input bg-background px-2 py-1"
              value={backend} disabled={!hydrated} onChange={(event) => {
                const url = new URL(window.location.href)
                url.searchParams.set("backend", event.target.value)
                window.location.assign(url.toString())
              }}>
              <option value="python">Python</option>
              <option value="scala">Scala</option>
            </select>
          </label>
          <span className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-card px-2 py-1">
            <span className={cn("size-2 rounded-full", online === null ? "bg-muted-foreground" : online ? "bg-green-500" : "bg-red-500")} />
            {online === null ? translateText("verificando…") : online ? translateText("API online") : translateText("API offline")}
          </span>
          <Button size="sm" variant="ghost" onClick={() => void fetchRuns()}><RotateCcw className="size-3.5" />{translateText(" Atualizar")}</Button>
        </div>
      </div>

      {error && <p role="alert" className="rounded-sm border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">{translateText(error)}</p>}
      {online === false && <p className="text-xs text-muted-foreground">{translateText("Não foi possível contatar a API (porta 5000 por padrão, ")}<code className="font-mono">NEXT_PUBLIC_SIMEDAPE_API_URL</code>{translateText("). Inicie com scripts/run-native-integration-demo.sh.")}</p>}

      <p className="rounded-sm border border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">{translateText("Fluxo: o HTC executa a simulação ")}<b>{translateText("base")}</b>{translateText(" e você a revisa em ")}<Link href="/simulator/runs" className="text-primary underline">{translateText("Simulador → Execuções")}</Link>{translateText("; aqui o SimEDaPE ")}<b>{translateText("treina")}</b>{translateText(" o modelo, indica o que")}<b>{translateText(" selecionar")}</b>{translateText(", o HTC executa a ")}<b>{translateText("parcial")}</b>{translateText(" e o modelo ")}<b>{translateText("estima")}</b>{translateText(" o resultado completo.")}</p>

      <nav role="tablist" aria-label={translateText("Etapas")} className="flex flex-wrap gap-1">
        {STEPS.map((s) => {
          const run = s.id === "train" || s.id === "select" || s.id === "estimate" || s.id === "sweep" ? stepRun[s.id] : null
          const selected = step === s.id
          return (
            <button key={s.id} type="button" role="tab" aria-selected={selected} onClick={() => setStep(s.id)} title={translateText(s.hint)}
              className={cn("flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-xs", selected ? "border-primary bg-primary/10 font-medium" : "border-border text-muted-foreground hover:text-foreground")}>
              {translateText(s.label)}
              {run?.status === "completed" && <Check className="size-3 text-green-600 dark:text-green-400" />}
              {run && isActive(run.status) && <Loader2 className="size-3 animate-spin" />}
              {run?.status === "failed" && <X className="size-3 text-red-600" />}
              {s.id === "runs" && runs.length > 0 && <span className="rounded-sm bg-muted px-1 text-[9px]">{translateText(runs.length)}</span>}
            </button>
          )
        })}
      </nav>

      <section role="tabpanel" className="flex flex-col gap-4 rounded-sm border border-border bg-card p-4">
        <p className="text-[11px] text-muted-foreground">{translateText(STEPS.find((s) => s.id === step)?.hint)}</p>

        {step === "base" && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={translateText("De onde vêm os dados da base")} hint={form.dataSource === "clickhouse" ? translateText("O engine grava os eventos no ClickHouse; escolha a simulação (simulation_id).") : translateText("Pasta com um CSV por via (separador ;), na máquina da API.")}>
                <select className={input} value={form.dataSource} onChange={(e) => set("dataSource", e.target.value as DataSource)}>
                  <option value="clickhouse">{translateText("ClickHouse (simulações gravadas)")}</option>
                  <option value="csv">{translateText("Pasta de CSVs")}</option>
                </select>
              </Field>
              <Field label={translateText("Nome do cenário")} hint={translateText("Identifica os resultados em disco. Etapas com o mesmo nome compartilham o modelo treinado.")}>
                <input className={input} value={form.scenarioName} onChange={(e) => set("scenarioName", e.target.value)} />
              </Field>

              {form.dataSource === "clickhouse" ? (
                <Field label={translateText("Simulação base")} wide hint={simsError ? undefined : simulations.length > 0 ? translateText("{0} simulações encontradas no ClickHouse. Escolha uma da lista ou digite o id.", { 0: simulations.length }) : translateText("Digite o id (simulation_id) ou atualize a lista.")}>
                  <select className={input} aria-label="Cenário e execução da base" value={simulations.some((s) => s.id === form.simulationId) ? form.simulationId : ""} onChange={(e) => chooseSimulation(e.target.value)}>
                    <option value="">Escolher cenário e execução…</option>
                    {simulations.map((s) => <option key={s.id} value={s.id}>{s.label ?? s.id}</option>)}
                  </select>
                  {simulations.find((s) => s.id === form.simulationId)?.run_kind === "partial" && <p role="alert" className="text-amber-600">Esta execução é parcial. Para treinar a base completa, escolha a execução marcada como base.</p>}
                  <span className="flex gap-2">
                    <input className={cn(input, "flex-1 font-mono")} list="base-simulations" placeholder={translateText("Escolha da lista ou digite o simulation_id")} value={form.simulationId} onChange={(e) => chooseSimulation(e.target.value)} />
                    <datalist id="base-simulations">
                      {simulations.map((s) => <option key={s.id} value={s.id} label={translateText("{0}{1}", { 0: s.link_count != null ? translateText("{0} vias", { 0: s.link_count.toLocaleString(intlLocale) }) : "", 1: s.events != null ? translateText(" · {0} eventos", { 0: s.events.toLocaleString(intlLocale) }) : "" })} />)}
                    </datalist>
                    <Button size="sm" variant="outline" type="button" onClick={() => void loadSimulations()}>{translateText("Atualizar lista")}</Button>
                  </span>
                  {simulations.length > 0 && (
                    <span className="flex flex-wrap gap-1.5 pt-0.5">
                      {simulations.slice(0, 8).map((s) => (
                        <button key={s.id} type="button" onClick={() => chooseSimulation(s.id)}
                          className={cn("rounded-sm border px-1.5 py-0.5 font-mono text-[10px]", form.simulationId === s.id ? "border-primary bg-primary/10" : "border-border text-muted-foreground hover:text-foreground")}>
                          {s.label ?? s.id}{s.link_count != null ? translateText(" · {0} vias", { 0: s.link_count.toLocaleString(intlLocale) }) : translateText("")}
                        </button>
                      ))}
                    </span>
                  )}
                  {simsError && <span className="text-[11px] text-yellow-700 dark:text-yellow-400">{translateText("Não foi possível listar as simulações: ")}{translateText(simsError)}{translateText(". Você ainda pode digitar o id. Para listar, configure o ClickHouse da API (veja ")}<Link href="/locations" className="underline">{translateText("Locais")}</Link>).</span>}
                </Field>
              ) : (
                <>
                  <Field label={translateText("Pasta dos CSVs da base")} wide hint={translateText("Um arquivo CSV por via, com as séries temporais.")}>
                    <span className="flex gap-2">
                      <input className={cn(input, "flex-1 font-mono")} placeholder={translateText("/caminho/para/cenario")} value={form.scenarioDir} onChange={(e) => set("scenarioDir", e.target.value)} />
                      <Button size="sm" variant="outline" type="button" onClick={() => setPicker(true)}>{translateText("Procurar…")}</Button>
                    </span>
                  </Field>
                  <Field label={translateText("Arquivo de informações das vias")} wide hint={translateText("CSV com link;length;capacity;freespeed.")}>
                    <input className={cn(input, "font-mono")} placeholder={translateText("/caminho/para/street_info.csv")} value={form.streetInfoFile} onChange={(e) => set("streetInfoFile", e.target.value)} />
                  </Field>
                </>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium">{translateText("Parâmetros")}</p>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <Button key={p.id} size="sm" variant={form.intervalSize === p.intervalSize && form.nClusters === p.nClusters ? "default" : "outline"} type="button" title={translateText(p.help)}
                    onClick={() => setForm((f) => ({ ...f, intervalSize: p.intervalSize, nClusters: p.nClusters }))}>{translateText(p.label)}</Button>
                ))}
                <span className="self-center text-[11px] text-muted-foreground">{translateText("Presets: ")}{translateText(PRESETS.map((p) => `${p.label} = ${p.nClusters} clusters, intervalos de ${p.intervalSize}`).join(" · "))}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label={translateText("Início")} hint={translateText("Primeiro instante analisado (ticks).")}><input className={input} type="number" value={form.startTime} onChange={(e) => set("startTime", e.target.value)} /></Field>
                <Field label={translateText("Fim")} hint={translateText("Último instante (ticks).")}><input className={input} type="number" value={form.endTime} onChange={(e) => set("endTime", e.target.value)} /></Field>
                <Field label={translateText("Intervalo")} hint={translateText("Largura de cada janela de agregação.")}><input className={input} type="number" value={form.intervalSize} onChange={(e) => set("intervalSize", e.target.value)} /></Field>
                <Field label={translateText("Clusters")} hint={translateText("Quantos grupos de vias parecidas.")}><input className={input} type="number" value={form.nClusters} onChange={(e) => set("nClusters", e.target.value)} /></Field>
              </div>
              {getSimedapeBackend() === "scala" && <Field label={translateText("Observações de ocupação")} hint={translateText("Agrupado: um valor final por via e instante, preservando os veículos. Exige histórico completo de entradas e saídas desde vias vazias; CSV precisa de event_type. Alterar exige novo treino. Não preenche segundos sem eventos.")}>
                <select className={input} value={form.observationMode} onChange={(e) => set("observationMode", e.target.value as Form["observationMode"])}>
                  <option value="events">{translateText("Por evento (compatível)")}</option>
                  <option value="grouped">{translateText("Agrupado por instante")}</option>
                </select>
              </Field>}
              <p className="text-[11px] text-muted-foreground">{intervals > 0 ? translateText("{0} intervalos por via, agrupados em {1} clusters.", { 0: intervals, 1: form.nClusters || "?" }) : translateText("Defina um fim maior que o início.")}</p>
            </div>

            <div className="flex flex-col gap-2 rounded-sm border border-dashed border-border p-3">
              <p className="text-xs font-medium">{translateText("Opcional: nomear e reaproveitar parâmetros")}</p>
              <p className="text-[11px] text-muted-foreground">{translateText("Nada disso guarda resultados nem dados. “Parâmetros salvos” são só os campos desta tela (base, intervalos, clusters), gravados na API para você reusar depois. O nome das execuções só ajuda a achá-las em Execuções.")}</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label={translateText("Prefixo do nome das execuções")} hint={translateText("Ex.: “teste-24h”. A etapa é acrescentada: “teste-24h · treino”.")}>
                  <input className={input} value={form.name} onChange={(e) => set("name", e.target.value)} />
                </Field>
                <Field label={translateText("Carregar parâmetros salvos")} hint={configs.length ? translateText("Preenche os campos acima.") : translateText("Nenhum salvo ainda.")}>
                  <select className={input} value={form.configName} onChange={(e) => { const c = configs.find((x) => x.name === e.target.value); if (c) setForm((f) => formFromConfig(f, c)); else set("configName", "") }}>
                    <option value="">—</option>
                    {configs.map((c) => <option key={c.name} value={c.name}>{translateText(c.name)}</option>)}
                  </select>
                </Field>
                <Field label={translateText("Salvar estes parâmetros como")} hint={translateText("Grava ao iniciar a próxima etapa.")}>
                  <input className={input} value={form.saveAs} onChange={(e) => set("saveAs", e.target.value)} />
                </Field>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" disabled={missing.length > 0} onClick={() => setStep("train")}>{translateText("Continuar: treinar →")}</Button>
              {missing.length > 0 && <span className="text-[11px] text-muted-foreground">{translateText("Falta: ")}{translateText(missing.join(", "))}.</span>}
            </div>
          </>
        )}

        {step === "train" && (
          <>
            <p className="text-xs text-muted-foreground">{translateText("Carrega a base, normaliza as séries, agrupa as vias com K-Shape, escolhe os pontos de simulação e treina o(s) método(s) de estimação. Tudo é gravado em ")}<b>{translateText("um único arquivo compacto")}</b>
              (<code className="font-mono">model.simedape</code>{translateText(") dentro da pasta do snapshot, em vez de gigabytes de JSON.")}</p>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="flex flex-col gap-2 rounded-sm border border-border p-3">
                <p className="text-xs font-medium">{translateText("Pré-requisitos")}</p>
                <ul className="flex flex-col gap-1 text-[11px]">
                  {trainChecklist(form).map((c) => (
                    <li key={c.label} className="flex gap-2">
                      <span className={cn("mt-0.5 shrink-0", c.ok ? "text-green-600 dark:text-green-400" : c.blocks ? "text-red-600 dark:text-red-400" : "text-yellow-600 dark:text-yellow-400")}>{c.ok ? translateText("✓") : c.blocks ? translateText("✕") : translateText("!")}</span>
                      <span><span className="font-medium">{translateText(c.label)}</span>{!c.ok && <span className="text-muted-foreground"> · {translateText(c.hint)}</span>}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-[10px] text-muted-foreground">{translateText("Base: ")}{form.dataSource === "clickhouse" ? translateText("ClickHouse · {0}", { 0: simulations.find((entry) => entry.id === form.simulationId)?.label ?? form.simulationId ?? "(não escolhida)" }) : translateText("CSV · {0}", { 0: form.scenarioDir || "(não escolhida)" })} · {translateText(form.nClusters)}{translateText(" clusters")}</p>
              </div>

              <div className="flex flex-col gap-2 rounded-sm border border-border p-3">
                <p className="text-xs font-medium">{translateText("Como o modelo estima")}</p>
                {([["dtw", "DTW (warping paths)", "Alinha cada série ao centróide do cluster; usado pelos métodos avg, sample, wavg e base."], ["pca", "PCA por cluster", "Componentes principais de cada cluster; estima a partir dos pesos do ponto de simulação."]] as const).map(([id, label, help]) => (
                  <label key={id} className="flex items-start gap-2 text-xs">
                    <input type="checkbox" className="mt-0.5" checked={form.trainMethods.includes(id)} onChange={(e) => set("trainMethods", e.target.checked ? [...form.trainMethods, id] : form.trainMethods.filter((x) => x !== id))} />
                    <span><span className="font-medium">{translateText(label)}</span><br /><span className="text-[11px] text-muted-foreground">{translateText(help)}</span></span>
                  </label>
                ))}
                {form.trainMethods.includes("dtw") && backend === "scala" && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-xs">{translateText("Algoritmo DTW")}
                      <select aria-label="DTW algorithm" className="h-8 rounded-sm border border-border bg-background px-2 text-xs" value={form.dtwAlgorithm} onChange={(e) => set("dtwAlgorithm", e.target.value as "exact" | "fastdtw")}>
                        <option value="exact">{translateText("DTW exato (janela de 10%)")}</option>
                        <option value="fastdtw">{translateText("FastDTW (aproximado)")}</option>
                      </select>
                    </label>
                    {form.dtwAlgorithm === "fastdtw" && <label className="flex flex-col gap-1 text-xs">{translateText("Raio do FastDTW")}
                      <input aria-label="FastDTW radius" className="h-8 rounded-sm border border-border bg-background px-2 text-xs" type="number" min={0} max={128} value={form.dtwRadius} onChange={(e) => set("dtwRadius", e.target.value)} />
                    </label>}
                    <label className="flex flex-col gap-1 text-xs">{translateText("Workers DTW (0 = automático)")}
                      <input aria-label="DTW workers" className="h-8 rounded-sm border border-border bg-background px-2 text-xs" type="number" min={0} max={256} value={form.dtwWorkers} onChange={(e) => set("dtwWorkers", e.target.value)} />
                    </label>
                    <label className="flex flex-col gap-1 text-xs">{translateText("Séries por lote DTW")}
                      <input aria-label="DTW batch size" className="h-8 rounded-sm border border-border bg-background px-2 text-xs" type="number" min={1} max={4096} value={form.dtwBatchSize} onChange={(e) => set("dtwBatchSize", e.target.value)} />
                    </label>
                    <p className="text-[11px] text-muted-foreground sm:col-span-2">{translateText("Workers livres recebem novos lotes, dentro dos limites de CPU e memória do serviço.")}</p>
                    {form.dtwAlgorithm === "fastdtw" && <p className="text-[11px] text-muted-foreground sm:col-span-2">{translateText("FastDTW pode alterar os caminhos e as estimativas. O raio controla a busca: valores maiores ampliam o refinamento. Compare o erro após o treino.")}</p>}
                  </div>
                )}
                {form.trainMethods.includes("pca") && (
                  <div className="flex flex-col gap-1.5">
                    {getSimedapeBackend() === "scala" && <label className="flex flex-col gap-1 text-xs">{translateText("Seleção do PCA por cluster")}
                      <select aria-label="PCA selection mode" className={input} value={form.pcaMode} onChange={(e) => set("pcaMode", e.target.value as Form["pcaMode"])}>
                        <option value="components">{translateText("Quantidade de componentes")}</option>
                        <option value="variance">{translateText(form.pcaCentering === "simulation_point" ? "Percentual de energia residual" : "Percentual de variância explicada")}</option>
                      </select>
                    </label>}
                    {getSimedapeBackend() === "scala" && <label className="flex flex-col gap-1 text-xs">{translateText("Base de reconstrução do PCA")}
                      <select aria-label="PCA centering" className={input} value={form.pcaCentering} onChange={e => set("pcaCentering", e.target.value as Form["pcaCentering"])}>
                        <option value="cluster_mean">{translateText("Média do cluster (padrão)")}</option>
                        <option value="simulation_point">{translateText("Ponto de simulação do treino (experimental)")}</option>
                      </select>
                    </label>}
                    {getSimedapeBackend() === "scala" && form.pcaCentering === "simulation_point" && <p className="text-[11px] text-muted-foreground">{translateText("Aprende desvios em relação ao ponto de simulação completo do treino. A seleção percentual mede energia residual, não variância centrada. Exige novo treino PCA; o ponto parcial é comparado à base salva.")}</p>}
                    {getSimedapeBackend() === "scala" && form.pcaMode === "variance" ? <label className="flex flex-col gap-1 text-xs">{translateText(form.pcaCentering === "simulation_point" ? "Meta de energia residual por cluster (%)" : "Meta de variância por cluster (%)")}
                      <input aria-label="PCA variance target" className={input} type="number" min={0.1} max={100} step={0.1} value={form.pcaVariance} onChange={(e) => set("pcaVariance", e.target.value)} />
                    </label> : <label className="flex flex-col gap-1 text-xs">{translateText("Componentes do PCA")}<input aria-label="PCA component count" className={input} type="number" min={1} step={1} value={form.pcaComponents} onChange={(e) => set("pcaComponents", e.target.value)} /></label>}
                    {getSimedapeBackend() === "scala" && <p className="text-[11px] text-muted-foreground">{translateText("Cada cluster é treinado separadamente. A meta seleciona a menor quantidade que retém a variância pedida; pode resultar em quantidades diferentes por cluster. Metas maiores aumentam os pesos armazenados.")}</p>}
                    <details className="text-[11px] text-muted-foreground">
                      <summary className="cursor-pointer">{translateText("O que é este valor?")}</summary>
                      <div className="mt-1.5 flex flex-col gap-1.5">
                        <p>{translateText("É quantos padrões temporais o PCA guarda em cada cluster. O 1º é o padrão que mais explica as diferenças entre as séries (por exemplo, pico da manhã mais forte ou mais fraco), o 2º é o segundo mais importante, e assim por diante. Cada série vira: ")}<b>{translateText(form.pcaCentering === "simulation_point" ? "ponto de simulação do treino + peso₁ × padrão₁ + peso₂ × padrão₂ + …" : "média do cluster + peso₁ × padrão₁ + peso₂ × padrão₂ + …")}</b></p>
                        <p>{translateText("Na estimativa, só existe o começo da série (simulação parcial). O PCA acha os pesos que reproduzem esse começo e usa os mesmos pesos para reconstruir a série inteira.")}</p>
                        <ul className="list-disc pl-4">
                          <li><b>{translateText("Poucos (1 a 3):")}</b>{translateText(" só a forma geral; estável, mas perde detalhes.")}</li>
                          <li><b>{translateText("Muitos:")}</b>{translateText(" reproduzem bem o trecho parcial, mas podem ajustar o ruído e extrapolar mal o resto (overfitting).")}</li>
                          <li><b>{translateText("Limite:")}</b>{translateText(" cortado para o nº de séries do cluster (cluster com 3 séries usa no máximo 3).")}</li>
                          <li><b>{translateText("Como escolher:")}</b>{translateText(" compare os resultados por cluster e o erro na etapa Estimar. A variância explicada mede a representação dos dados de treino; não garante a precisão das estimativas.")}</li>
                        </ul>
                      </div>
                    </details>
                  </div>
                )}
              </div>
            </div>

            <details className="rounded-sm border border-border p-3">
              <summary className="cursor-pointer text-xs font-medium">{translateText("Parâmetros avançados do treino")}</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {([["randomState", "Semente do K-Shape", "Mesma semente, mesmo agrupamento."], ["maxIter", "Iterações máximas", "Mais iterações refinam e demoram mais."], ["clusteringSize", "Tamanho para agrupar", "0 = tamanho das séries. Menor acelera o K-Shape."]] as const).map(([k, label, hint]) => (
                  <label key={k} className="flex flex-col gap-1 text-xs">{translateText(label)}
                    <input className="h-8 rounded-sm border border-border bg-background px-2 text-xs" type="number" value={form[k]} onChange={(e) => set(k, e.target.value)} />
                    <span className="text-[10px] text-muted-foreground">{translateText(hint)}</span>
                  </label>
                ))}
                <label className="flex flex-col gap-1 text-xs">{translateText("Separador do CSV")}<input className="h-8 rounded-sm border border-border bg-background px-2 text-xs" value={form.csvSep} onChange={(e) => set("csvSep", e.target.value)} />
                  <span className="text-[10px] text-muted-foreground">{translateText("Só para a base em CSV.")}</span>
                </label>
                <label className="flex flex-col gap-1 text-xs sm:col-span-2">{translateText("Precisão do DTW no arquivo")}<select className="h-8 rounded-sm border border-border bg-background px-2 text-xs" value={form.precision} onChange={(e) => set("precision", e.target.value as "float64" | "float32")}>
                    <option value="float64">{translateText("float64 (exata, recomendada)")}</option>
                    <option value="float32">{translateText("float32 (menor, com perda)")}</option>
                  </select>
                  <span className="text-[10px] text-muted-foreground">{translateText("float32 pode mudar resultados nos pontos de descontinuidade das métricas.")}</span>
                </label>
                <p className="text-[11px] text-muted-foreground sm:col-span-3">{translateText("Estágios desta execução: ")}<span className="font-mono">{translateText(trainStagesFor(form.trainMethods).join(" → "))}</span></p>
              </div>
            </details>

            {backend === "scala" && <>
              <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={form.checkpointData} onChange={event => set("checkpointData", event.target.checked)} />
                {translateText("Salvar também a base carregada e normalizada para futuras retomadas. Usa espaço adicional em disco.")}
              </label>
              <TrainingRecovery runs={runs} disabled={starting !== null || anyActive} currentOptions={recoveryOptions} onStarted={async result => {
                setForm(previous => ({ ...formFromConfig(previous, { name: "", config: result.plan.config }), trainMethods: result.plan.methods, snapshot: result.run_id }))
                await fetchRuns()
              }} />
            </>}
            {translateText(runPanel("train", "Treinar novo modelo", trainChecklist(form).some((c) => c.blocks && !c.ok) ? `Complete: ${trainChecklist(form).filter((c) => c.blocks && !c.ok).map((c) => c.label).join(", ")}.` : null))}

            {trainRun && (
              <div className="flex flex-col gap-1">
                <p className="text-xs font-medium">{translateText("Log da execução ")}{isActive(trainRun.status) && <span className="text-[10px] font-normal text-muted-foreground">{translateText("· atualizando")}</span>}</p>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-sm bg-muted/40 p-3 font-mono text-[10px]">{trainLogs && trainLogs.id === trainRun.run_id && trainLogs.text ? trainLogs.text.slice(-20000) : "(sem saída ainda)"}</pre>
              </div>
            )}

            {trainRun?.status === "completed" && !trainModel && (
              <p className="text-[11px] text-muted-foreground">{translateText("Esta execução não gerou um arquivo de modelo.")}</p>
            )}
            {trainRun?.status === "completed" && trainModel && (
              <>
                <ModelResult model={trainModel} runId={trainRun.run_id} runName={trainRun.name} />
                <ClusteringReportView runId={trainRun.run_id} runName={trainRun.name} />
              </>
            )}
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium">{translateText("Snapshots (modelos treinados)")}</p>
              <p className="text-[11px] text-muted-foreground">{translateText("Cada treino concluído é um snapshot: o modelo completo fica em uma pasta própria e nunca é sobrescrito. Seleção e Estimativa usam o snapshot marcado abaixo e gravam só dentro dele. Treinar de novo cria outro snapshot, então dá para comparar parâmetros e abordagens.")}</p>
              {snapshots.length === 0 ? (
                <p className="text-xs text-muted-foreground">{translateText("Nenhum snapshot ainda.")}</p>
              ) : (
                <ul className="divide-y divide-border rounded-sm border border-border text-xs">
                  {snapshots.map((r) => (
                    <li key={r.run_id}>
                      <button type="button" onClick={() => set("snapshot", r.run_id)} className={cn("flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-muted/50", snapshot?.run_id === r.run_id && "bg-primary/5")}>
                        <span className="flex items-center gap-2">
                          <span className={cn("size-3 rounded-full border", snapshot?.run_id === r.run_id ? "border-primary bg-primary" : "border-border")} />
                          <span className="font-medium">{translateText(r.name)}</span>
                          {snapshot?.run_id === r.run_id && <span className="rounded-sm bg-primary/10 px-1.5 text-[9px] font-semibold uppercase text-primary">{translateText("em uso")}</span>}
                        </span>
                        <span className="pl-5 text-[10px] text-muted-foreground">{translateText(fmtTs(r.created_at, intlLocale))}{translateText(" · base: ")}{translateText(describeSource(r.meta.data_source))}</span>
                        <span className="pl-5 font-mono text-[10px] text-muted-foreground">{translateText(r.meta.output_dir)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {trainRun?.status === "completed" && <Button size="sm" variant="outline" className="self-start" onClick={() => setStep("select")}>{translateText("Continuar: seleção →")}</Button>}
          </>
        )}

        {step === "select" && (
          <>
            <p className="text-xs text-muted-foreground">{translateText("Escolhe quais unidades (veículos ou pessoas) entram na simulação parcial e grava o manifesto de seleção. Requer o modelo treinado.")}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={translateText("Estratégia")} hint={translateText(STRATEGIES.find((s) => s.id === form.strategy)?.help)} wide>
                <select className={input} value={form.strategy} onChange={(e) => set("strategy", e.target.value)}>{STRATEGIES.map((s) => <option key={s.id} value={s.id}>{translateText(s.label)}</option>)}</select>
              </Field>
              <Field label={translateText("Percentual")} hint={translateText("Fração das unidades mantidas.")}><input className={input} type="number" min={1} max={100} value={form.percentage} onChange={(e) => set("percentage", e.target.value)} /></Field>
              <Field label={translateText("Semente")} hint={translateText("Mesma semente, mesma seleção.")}><input className={input} type="number" value={form.seed} onChange={(e) => set("seed", e.target.value)} /></Field>
            </div>
            {TOPOLOGY_STRATEGIES.includes(form.strategy) && (
              <div className="flex flex-col gap-2 rounded-sm border border-border p-3">
                <Field label={translateText("Mapa (topologia)")} hint={mapOptions.length > 0 ? translateText("{0} cenários nas localizações. Escolha um da lista ou digite um caminho (city_map.json ou a pasta do cenário).", { 0: mapOptions.length }) : translateText("Digite o caminho do city_map.json (ou da pasta do cenário), ou cadastre localizações em /locations.")} wide>
                  <span className="flex gap-2">
                    <input className={cn(input, "flex-1 font-mono")} list="map-scenarios" placeholder={translateText("Escolha da lista ou digite um caminho")} value={form.topologyFile} onChange={(e) => set("topologyFile", e.target.value)} />
                    <datalist id="map-scenarios">
                      {mapOptions.map((m) => <option key={m.ref} value={m.ref} label={translateText(m.label)} />)}
                    </datalist>
                    <Button size="sm" variant="outline" type="button" onClick={loadMapOptions}>{translateText("Atualizar lista")}</Button>
                  </span>
                  {mapOptions.length > 0 && (
                    <span className="flex flex-wrap gap-1.5 pt-0.5">
                      {mapOptions.slice(0, 8).map((m) => (
                        <button key={m.ref} type="button" onClick={() => set("topologyFile", m.ref)}
                          className={cn("rounded-sm border px-1.5 py-0.5 font-mono text-[10px]", form.topologyFile === m.ref ? "border-primary bg-primary/10" : "border-border text-muted-foreground hover:text-foreground")}>
                          {translateText(m.ref)}
                        </button>
                      ))}
                    </span>
                  )}
                </Field>
                <p className="text-[11px] text-muted-foreground">{translateText("Como funciona: para cada cluster, começa pela via do ponto de simulação e adiciona todas as unidades que passaram por ela (em qualquer intervalo). Se a cota do cluster ainda não fechou, avança para as vias vizinhas (1 salto, 2 saltos…). A última via pode entrar parcialmente, por sorteio com a semente. Sobra de cota, quando o mapa se esgota, é completada aleatoriamente. Os ids das vias do mapa precisam ser os mesmos da base.")}</p>
              </div>
            )}
            {backend === "scala" && <SelectionSchedulingControl onChange={setSelectionScheduling} />}
            {translateText(runPanel("select", "Selecionar", snapshotBlocker ?? (TOPOLOGY_STRATEGIES.includes(form.strategy) && !form.topologyFile.trim() ? "Informe o arquivo do mapa (topologia)." : null), snapshotField))}
            {selectRun?.status === "completed" && (
              <>
                <p className="text-[11px] text-muted-foreground">{translateText("O manifesto e os arquivos de seleção ficam na pasta de saída da execução (veja em Execuções → Artefatos).")}</p>
                <Button size="sm" variant="outline" className="self-start" onClick={() => setStep("partial")}>{translateText("Continuar: parcial →")}</Button>
              </>
            )}
          </>
        )}

        {step === "alter" && (
          <>
            <div className="rounded-sm border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs">
              <p className="font-semibold text-yellow-700 dark:text-yellow-400">{translateText("Etapa opcional, ainda em preparação.")}</p>
              <p className="mt-1 text-muted-foreground">{translateText("Aqui você escreve e valida as alterações. O engine ainda ")}<b>{translateText("não aplica")}</b>{translateText(" o arquivo na simulação (nem na parcial): hoje ele serve para definir e checar o what-if. Mapa e infraestrutura entram em seguida. Formato: ")}<code className="font-mono">simedape/docs/MODIFICATIONS.md</code>{translateText(". Também está disponível fora do fluxo, em Modificações.")}</p>
            </div>
            <ModificationsEditor scenarioRef={form.baseScenario || undefined} embedded />
            {!form.baseScenario && <p className="text-[11px] text-muted-foreground">{translateText("Sem cenário base escolhido no passo Parcial, use o campo acima; ou abra a página Modificações.")}</p>}
          </>
        )}

        {step === "partial" && (
          <>
            <p className="text-xs text-muted-foreground">{translateText("Roda no HTC só a parte da simulação escolhida na etapa 3. O cenário base não é alterado: a tela grava um ")}<code className="font-mono">simulation.partial.json</code>{translateText(" ao lado dele, com o bloco")}<code className="font-mono"> partial</code>{translateText(", e o engine carrega só as unidades da seleção (e o que as relações de composição exigem). Ônibus, estações, metrô e infraestrutura continuam completos.")}</p>
            {form.dataSource === "clickhouse" && <Field label="Arquivo de informações das vias" wide hint="Preenchido ao escolher o cenário. Caminho como a API o enxerga.">
              <input className={cn(input, "font-mono")} value={form.streetInfoFile} onChange={(e) => set("streetInfoFile", e.target.value)} />
              <Button size="sm" variant="outline" onClick={() => chooseSimulation(form.simulationId)}>Aplicar parâmetros do cenário selecionado</Button>
              <Field label="Amostragem regular (s)" hint="300 = médias de ocupação a cada cinco minutos; 0 = eventos originais."><input className={input} type="number" value={form.samplePeriod} onChange={(e) => set("samplePeriod",e.target.value)} /></Field>
            </Field>}
            <div className="flex flex-col gap-3 rounded-sm border border-border p-3">
              <Field label={translateText("Cenário base (entrada do HTC)")} hint={translateText("O cenário de entrada que gerou a simulação base. Use as mesmas configurações da base (semente, duração, passo de tempo) para a comparação valer.")} wide>
                <span className="flex gap-2">
                  <input className={cn(input, "flex-1 font-mono")} list="partial-base-scenarios" placeholder={translateText("Escolha da lista, ex.: repo:meu-cenario")} value={form.baseScenario} onChange={(e) => set("baseScenario", e.target.value)} />
                  <datalist id="partial-base-scenarios">{mapOptions.map((m) => <option key={m.ref} value={m.ref} label={translateText(m.label)} />)}</datalist>
                  <Button size="sm" variant="outline" type="button" onClick={loadMapOptions}>{translateText("Atualizar lista")}</Button>
                </span>
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={translateText("Seleção")} hint={selectionRuns.length > 0 ? translateText("As seleções geradas na etapa 3 para o snapshot em uso (a mais recente primeiro).") : translateText("Rode a etapa 3 ou informe o caminho de um selection.json.")}>
                  <>
                    <select
                      className={input}
                      value={selectionManual || (!selectionIsListed && selectionInUse) ? "__manual__" : selectionInUse}
                      onChange={(e) => {
                        if (e.target.value === "__manual__") setSelectionManual(true)
                        else {
                          setSelectionManual(false)
                          set("selectionFile", e.target.value)
                        }
                      }}
                    >
                      {selectionRuns.length === 0 && <option value="">{translateText("Nenhuma seleção concluída")}</option>}
                      {selectionRuns.map((r) => (
                        <option key={r.run_id} value={`${trimDir(r.meta.output_dir)}/selection.json`}>{translateText(r.name)} · {translateText(fmtTs(r.created_at, intlLocale))}</option>
                      ))}
                      <option value="__manual__">{translateText("Outro caminho…")}</option>
                    </select>
                    {(selectionManual || (!selectionIsListed && !!selectionInUse)) && (
                      <input className={cn(input, "mt-1 font-mono")} placeholder={translateText("/caminho/selection.json")} value={form.selectionFile} onChange={(e) => set("selectionFile", e.target.value)} />
                    )}
                  </>
                </Field>
                <Field label={translateText("Classes filtráveis")} hint={translateText("Só estas classes podem ser removidas. As demais são sempre criadas (ônibus, metrô e estações ficam de fora).")}>
                  <input className={cn(input, "font-mono")} value={form.filterableClasses} onChange={(e) => set("filterableClasses", e.target.value)} />
                </Field>
              </div>
              <Field label={translateText("Engine")} hint={engines.length === 0 ? translateText("Nenhum engine cadastrado: cadastre em /locations.") : translateText("O engine em que a parcial vai rodar. Ele precisa conseguir ler a seleção no mesmo caminho.")}>
                <select className={input} value={form.engineId} onChange={(e) => set("engineId", e.target.value)}>
                  <option value="">{translateText("Escolha…")}</option>
                  {engines.map((e) => <option key={e.id} value={e.id}>{translateText(e.label || e.id)} · {translateText(e.url)}</option>)}
                </select>
              </Field>
              <ModificationPicker scenarioRef={form.baseScenario.trim()} value={form.modFiles} onChange={setModFiles} refreshKey={modRefresh} />
              {form.baseScenario.trim() && (
                <details className="rounded-sm border border-border p-3">
                  <summary className="cursor-pointer text-xs font-medium">{translateText("Criar ou editar modificações deste cenário aqui")}</summary>
                  <div className="mt-3">
                    <ModificationsEditor scenarioRef={form.baseScenario.trim()} embedded onSaved={(name) => { setModRefresh((n) => n + 1); if (!form.modFiles.includes(name)) setModFiles([...form.modFiles, name]) }} />
                  </div>
                </details>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={partialBusy || !form.baseScenario.trim() || !selectionInUse || !form.engineId} onClick={() => void startPartial("partial")}>
                  {partialBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}{translateText(" Iniciar parcial")}{form.modFiles.length ? translateText(" (alterada)") : translateText("")}
                </Button>
                <Button size="sm" variant="outline" disabled={partialBusy || !form.baseScenario.trim() || form.modFiles.length === 0 || !form.engineId} onClick={() => void startPartial("reference")}
                  title={translateText("Roda o cenário inteiro, sem filtro, com as mesmas modificações. É a referência para medir o erro da estimativa.")}>{translateText("Rodar a completa alterada (referência)")}</Button>
              </div>
              {form.modFiles.length > 0 && <p className="text-[11px] text-muted-foreground">{translateText("A parcial e a referência usam exatamente esta lista, nesta ordem; só assim a comparação vale.")}</p>}
              {partialError && <p className="text-[11px] text-destructive">{translateText(partialError)}</p>}
            </div>

            {partialRun && (
              <div className="flex flex-col gap-3">
                <RunMonitor engineUrl={partialRun.engineUrl}
                  partial={partialRun.kind === "partial" ? (partialReport ? `${partialReport.kept} de ${partialReport.filterable_actors} unidades filtráveis` : "carregando filtro…") : null}
                  altered={partialRun.modifications.length ? partialRun.modifications.join(" + ") : null} />
                {partialRun.note && <p className="text-[11px] text-yellow-600 dark:text-yellow-400">{translateText(partialRun.note)}</p>}
                <div className="flex gap-1 border-b border-border">
                  {([["progress", "Execução"], ["metrics", "Métricas"], ["logs", "Logs"], ["filter", "Filtro da parcial"]] as const).map(([id, label]) => (
                    <button key={id} type="button" onClick={() => setPartialTab(id)}
                      className={cn("-mb-px border-b-2 px-3 py-1.5 text-xs", partialTab === id ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                      {translateText(label)}
                    </button>
                  ))}
                </div>
                {partialTab === "progress" && (
                  <p className="text-[11px] text-muted-foreground">{translateText("Estado e progresso acima. As métricas do engine (as mesmas do Simulator) e os logs estão nas abas ao lado; a configuração completa do engine fica na página Simulator. Simulação base de comparação: ")}<span className="font-mono">{form.dataSource === "clickhouse" ? translateText(form.simulationId || "—") : translateText(form.scenarioDir || "—")}</span>{translateText(" · id desta parcial: ")}<span className="font-mono">{translateText(partialSimId ?? "—")}</span>
                  </p>
                )}
                {partialTab === "metrics" && <MetricsDashboard />}
                {partialTab === "logs" && <LogsPanel />}
                {partialTab === "filter" &&
                  (partialReport ? (
                    <div className="rounded-sm border border-border p-3 text-[11px]">
                      <p className="mb-1 text-xs font-medium">{translateText("Relatório do filtro")}</p>
                      <p>{translateText(partialReport.kept)}{translateText(" mantidas · ")}{translateText(partialReport.removed)}{translateText(" removidas · ")}{translateText(partialReport.selected_units)}{translateText(" selecionadas · ")}{translateText(partialReport.actors_scanned.toLocaleString(intlLocale))}{translateText(" atores lidos")}</p>
                      <p className="text-muted-foreground">{translateText("Por motivo: ")}{translateText(Object.entries(partialReport.kept_by_reason).map(([k, v]) => `${k}: ${v}`).join(" · ") || "—")}</p>
                      <p className="text-muted-foreground">{translateText("Por classe: ")}{translateText(Object.entries(partialReport.kept_by_class).map(([k, v]) => `${k.split(".").pop()} ${Object.values(v).reduce((a, b) => a + b, 0)}`).join(" · ") || "—")}</p>
                      {partialReport.selected_not_found.length > 0 && <p className="text-yellow-600 dark:text-yellow-400">{translateText(partialReport.selected_not_found.length)}{translateText(" unidade(s) da seleção não existem no cenário.")}</p>}
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">{translateText("Aguardando o relatório do filtro (gravado pelo engine ao carregar).")}</p>
                  ))}
              </div>
            )}

            {partialResultsField}
            <Button size="sm" className="self-start" disabled={!form.partial.trim()} onClick={() => setStep("estimate")}>{translateText("Continuar: estimar →")}</Button>
          </>
        )}

        {step === "estimate" && (
          <>
            <p className="text-xs text-muted-foreground">{translateText("Com o modelo treinado e a simulação parcial, estima o resultado completo e compara com a base (100%).")}</p>
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium">{translateText("Variações de estimação")}</span>
              <VariantPicker value={form.variants} onChange={(v) => set("variants", v)}
                available={{ dtw: snapshotModel ? snapshotModel.summary.methods.includes("dtw") : true, pca: snapshotModel ? snapshotModel.summary.methods.includes("pca") : true }} />
            </div>
            <Field label={translateText("Arquivo de informações das vias")} wide hint={translateText("CSV do cenário completo: link;length;capacity;freespeed. Obrigatório para métricas e estimativa.")}>
              <input className={cn(input, "font-mono")} placeholder="/scenarios/tl_1pct_meso/streets-simedape-repaired.csv" value={form.streetInfoFile} onChange={(e) => set("streetInfoFile", e.target.value)} />
            </Field>
            {partialResultsField}
            {previousEstimateInputs && estimateRun && !isActive(estimateRun.status) && (
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <Button size="sm" variant="outline" disabled={starting !== null} onClick={() => setForm(f => ({ ...f, ...previousEstimateInputs }))}>
                  <RotateCcw className="size-3.5" />{translateText("Reutilizar entradas da estimativa anterior")}
                </Button>
                <span className="font-mono text-muted-foreground">{previousEstimateInputs.partial}</span>
                <span className="text-muted-foreground">{translateText(fmtTs(estimateRun.created_at, intlLocale))}</span>
              </div>
            )}
            <ReferencePicker value={form.reference} onChange={(v) => set("reference", v)} isClickhouse={form.dataSource === "clickhouse"} simulations={simulations.map((x) => x.id)}
              base={form.dataSource === "clickhouse" ? form.simulationId : form.scenarioDir} hasModifications={form.modFiles.length > 0} />
            {translateText(runPanel("estimate", `Estimar (${form.variants.length} variações)`, snapshotBlocker ?? roadMetadataError(form.streetInfoFile) ?? (!form.partial.trim() ? "Informe a simulação parcial." : form.variants.length === 0 ? "Escolha ao menos uma variação." : null), snapshotField))}
            {estimateRun?.status === "completed" && <ResultsView runId={estimateRun.run_id} runName={estimateRun.name} />}
          </>
        )}

        {step === "sweep" && (
          <>
            <Field label={translateText("Arquivo de informações das vias")} wide hint={translateText("CSV do cenário completo: link;length;capacity;freespeed. Obrigatório para métricas e estimativa.")}>
              <input className={cn(input, "font-mono")} placeholder="/scenarios/tl_1pct_meso/streets-simedape-repaired.csv" value={form.streetInfoFile} onChange={(e) => set("streetInfoFile", e.target.value)} />
            </Field>

            <SweepPanel
              scenarios={form.sweepScenarios}
              onScenarios={(v) => set("sweepScenarios", v)}
              variants={form.sweepVariants}
              onVariants={(v) => set("sweepVariants", v)}
              defaultPartial={form.partial}
              isClickhouse={form.dataSource === "clickhouse"}
              simulations={simulations.filter((x) => x.id !== form.simulationId).map((x) => x.id)}
              available={{ dtw: snapshotModel ? snapshotModel.summary.methods.includes("dtw") : true, pca: snapshotModel ? snapshotModel.summary.methods.includes("pca") : true }}
            />
            <ReferencePicker value={form.reference} onChange={(v) => set("reference", v)} isClickhouse={form.dataSource === "clickhouse"} simulations={simulations.map((x) => x.id)}
              base={form.dataSource === "clickhouse" ? form.simulationId : form.scenarioDir} hasModifications={form.modFiles.length > 0} />
            {translateText(runPanel("sweep", `Varrer (${form.sweepVariants.length} variações × ${form.sweepScenarios.filter((r) => r.dir.trim()).length} parciais)`, snapshotBlocker ?? roadMetadataError(form.streetInfoFile) ?? (form.sweepVariants.length === 0 ? "Escolha ao menos uma variação." : form.sweepScenarios.filter((r) => r.dir.trim()).length === 0 ? "Informe ao menos uma parcial." : null), snapshotField))}
            {sweepRun?.status === "completed" && <SweepResults runId={sweepRun.run_id} />}
          </>
        )}

        {step === "runs" && (
          <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
            <ul className="max-h-[32rem] divide-y divide-border overflow-y-auto rounded-sm border border-border text-xs">
              {runs.length === 0 && <li className="p-3 text-muted-foreground">{translateText("Nenhuma execução ainda.")}</li>}
              {runs.map((r) => (
                <li key={r.run_id}>
                  <button type="button" onClick={() => setSelectedRun(r.run_id)} className={cn("flex w-full flex-col gap-1 px-3 py-2 text-left hover:bg-muted/50", r.run_id === selectedRun && "bg-muted/60")}>
                    <span className="flex items-center gap-2"><Badge status={r.status} /><span className="truncate font-medium">{translateText(r.name || r.run_id)}</span></span>
                    <span className="text-[10px] text-muted-foreground">{translateText(fmtTs(r.created_at, intlLocale))}</span>
                  </button>
                </li>
              ))}
            </ul>
            {detail ? (
              <div className="flex min-w-0 flex-col gap-3">
                <RunCard run={detail} onCancel={() => void cancel(detail.run_id)} />
                <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[11px] sm:grid-cols-3">
                  <div><dt className="text-muted-foreground">{translateText("Cenário")}</dt><dd>{translateText(detail.meta.scenario_name ?? "—")}</dd></div>
                  <div><dt className="text-muted-foreground">{translateText("Fonte")}</dt><dd className="break-all">{translateText(describeSource(detail.meta.data_source))}</dd></div>
                  <div><dt className="text-muted-foreground">{translateText("Concluído")}</dt><dd>{translateText(fmtTs(detail.finished_at, intlLocale))}</dd></div>
                  <div className="col-span-full"><dt className="text-muted-foreground">{translateText("Pasta de saída")}</dt><dd className="break-all font-mono">{translateText(detail.meta.output_dir ?? "—")}</dd></div>
                  <div className="col-span-full"><dt className="text-muted-foreground">{translateText("Estágios")}</dt><dd className="font-mono">{translateText(detail.meta.stages?.join(" → ") ?? "—")}</dd></div>
                </dl>
                {artifacts.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-medium">{translateText("Artefatos")}</p>
                    <ul className="flex flex-wrap gap-1.5 text-[11px]">{artifacts.map((a) => <li key={a.name} className="rounded-sm border border-border bg-muted/40 px-1.5 py-0.5 font-mono" title={translateText(a.kind)}>{translateText(a.name)}</li>)}</ul>
                  </div>
                )}
                <div>
                  <p className="mb-1 text-xs font-medium">{translateText("Logs")}</p>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-sm bg-muted/40 p-3 font-mono text-[10px]">{logs && logs.id === detail.run_id && logs.text ? logs.text.slice(-20000) : "(sem saída)"}</pre>
                </div>
                {detail.status === "completed" && detail.meta.stages?.includes("estimation") && <ResultsView runId={detail.run_id} runName={detail.name} />}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{translateText("Selecione uma execução.")}</p>
            )}
          </div>
        )}
      </section>

      {picker && <FolderPicker start={form.scenarioDir} onClose={() => setPicker(false)} onPick={(path) => { set("scenarioDir", path); setPicker(false) }} />}
    </div>
  )
}
