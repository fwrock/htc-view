/**
 * SimEDaPE REST API client (Flask, simedape/api/app.py -- see simedape/docs/API.md).
 * Configure the base URL via NEXT_PUBLIC_SIMEDAPE_API_URL (default: http://localhost:5000).
 *
 * Types mirror the server's JSON as-is (snake_case); there is no mapping layer.
 */

const BASE_URL =
  process.env.NEXT_PUBLIC_SIMEDAPE_API_URL ?? "http://localhost:5000"

export type SimedapeBackend = "python" | "scala"

/** URL-scoped choice: other HTC pages continue using the management API directly. */
export function getSimedapeBackend(): SimedapeBackend {
  const choice = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("backend")
  if (choice === "python" || choice === "scala") return choice
  return process.env.NEXT_PUBLIC_SIMEDAPE_BACKEND === "python" ? "python" : "scala"
}

export async function getSimedapeBackendDefault(): Promise<SimedapeBackend> {
  const response = await fetch(`${BASE_URL}/api/backends`)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const result = await response.json() as { default: string }
  return result.default === "python" ? "python" : "scala"
}

function apiBase(): string {
  const scala = typeof window !== "undefined" && window.location.pathname === "/simedape" && getSimedapeBackend() === "scala"
  return BASE_URL + (scala ? "/api/backends/scala" : "")
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
export type StageStatus = "pending" | "running" | "completed" | "failed"
export type DataSource = "csv" | "clickhouse"

export const ESTIMATION_METHODS = ["avg", "sample", "wavg", "base"] as const
export type EstimationMethod = (typeof ESTIMATION_METHODS)[number]

/** Stages offered pre-selected, in pipeline order (see simedape/docs/PIPELINE.md). */
export const DEFAULT_STAGES = [
  "data_load",
  "process_dataset",
  "clustering",
  "simulation_points",
  "warping_paths",
  "scenario_metrics",
  "estimation",
] as const

/** `describe_source` (simedape/io/source.py): never includes the ClickHouse password. */
export type SourceDescription =
  | {
      type: "clickhouse"
      host: string
      port: number
      database: string
      table: string
      simulation_id: string
    }
  | { type: "csv"; scenario_dir: string }
  | { type: "htc"; scenario: string }

export interface SimedapeHealth {
  status: "ok" | string
}

export interface StageInfo {
  name: string
  description: string
}

export interface ClickHouseSettings {
  host: string
  port: number
  database: string
  user: string
  password: string
  table: string
  simulation_id: string
  secure: boolean
}

export interface PcaTrainingSettings {
  centering?: "cluster_mean" | "simulation_point"
  selection_mode?: "components" | "variance"
  n_components?: number
  variance_threshold?: number
}

export interface SimedapeConfig {
  pca_training?: PcaTrainingSettings
  warping_paths?: { algorithm: "exact" | "fastdtw"; radius: number; n_jobs: number; batch_size: number }
  checkpoint_data?: boolean
  scenario_name: string
  scenario_dir: string
  street_info_file: string
  csv_sep: string
  output_dir: string
  input_dir: string
  intervals: { start_time: number; end_time: number; interval_size: number; sample_period?: number; observation_mode?: "events" | "grouped" }
  clustering: {
    n_clusters: number
    verbose: boolean
    random_state: number
    max_iter: number
    output_file: string
    clustering_size: number
  }
  transport_modes: string[]
  data_source: DataSource
  clickhouse: ClickHouseSettings
}

export interface NamedConfig {
  name: string
  config: SimedapeConfig
}

export interface SimulationEntry {
  label?: string
  scenario_name?: string
  scenario_id?: string
  scenario_key?: string
  run_kind?: string
  street_info_file?: string
  recommended_config?: Partial<SimedapeConfig>
  id: string
  link_count: number | null
  events: number | null
}

export interface SimulationsResponse {
  source: DataSource
  simulations: SimulationEntry[]
}

/** Scala resource measurements cover the JVM process, including concurrent jobs. */
export interface ResourceUsage {
  latest: Record<string, number | null>
  peaks: Record<string, number | null>
  cpu_seconds: number | null
  cpu_cores_mean: number | null
  cpu_cores_peak: number | null
  gc_seconds: number | null
  gc_collections: number | null
  disk_read_bytes: number | null
  disk_write_bytes: number | null
}
export interface PhaseMetrics {
  name: string
  status: string
  invocations: number
  elapsed_seconds: number
  resources: ResourceUsage
  details: Record<string, unknown>
  work: { completed: number | null; total: number | null; unit: string; percent: number | null; rate_per_second: number | null; eta_seconds: number | null }
}
export interface StageMetrics {
  index: number
  name: string
  status: string
  started_at: number
  finished_at: number | null
  elapsed_seconds: number
  scope: "jvm_process"
  sampled_at: number
  current_phase: string | null
  details: Record<string, unknown>
  resources: ResourceUsage
  phases: PhaseMetrics[]
  storage?: { path?: string; filesystem?: string; total_bytes?: number; usable_bytes?: number; minimum_free_bytes?: number; below_minimum?: boolean }
  collection_errors: number
  last_collection_error: string | null
  samples?: { at: number; elapsed_seconds: number; phase: string | null; resources: Record<string, number | null> }[]
}
export interface RunMetrics {
  schema_version: number
  scope: "jvm_process"
  sample_interval_seconds: number
  max_samples_per_stage: number
  collection_errors: number
  stages: StageMetrics[]
}

export interface StageProgress {
  name: string
  status: StageStatus
  started_at: number | null
  elapsed: number | null
  error?: string | null
  metrics?: StageMetrics
}

export interface RunProgress {
  total: number
  completed: number
  percent: number
  current_index: number | null
  current_stage: string | null
  stages: StageProgress[]
}

/** `GET /api/runs/<id>/progress`: run status fields plus the flattened per-stage progress. */
export type RunProgressResponse = RunProgress & {
  run_id: string
  name: string
  status: RunStatus
  data_source: SourceDescription | null
  created_at: number
  started_at: number | null
  finished_at: number | null
  error: string | null
}

export interface RunSummary {
  run_id: string
  name: string
  status: RunStatus
  created_at: number
  started_at: number | null
  finished_at: number | null
  error: string | null
  result: Record<string, unknown> | null
  meta: {
    workflow?: "htc_native" | "htc_osm_preview" | "htc_osm_publish"
    native_live?: unknown
    scenario_name?: string
    output_dir?: string
    data_source?: SourceDescription
    config?: string | null
    stages?: string[]
    stage_params?: Record<string, Record<string, unknown>>
    training?: boolean
    resume_of?: string | null
    recovery?: TrainingResumePlan | null
  }
  progress: RunProgress
  logs?: string
  persistence_error?: string
}

export interface RunStartBody {
  name?: string
  stages: string[]
  /** Name of a saved config, or an inline config dict. */
  config?: string | Partial<SimedapeConfig> | Record<string, unknown>
  stage_params?: Record<string, Record<string, unknown>>
}

export interface TrainingResumeOptions {
  from_stage?: "auto" | "data_load" | "process_dataset" | "clustering" | "warping_paths" | "pca_train" | "model_export"
  methods?: ("dtw" | "pca")[]
  warping_paths?: { algorithm: "exact" | "fastdtw"; radius: number; n_jobs: number; batch_size: number }
  pca_components?: number
  pca_training?: PcaTrainingSettings
  clustering?: { n_clusters: number; max_iter: number; random_state: number; clustering_size: number }
  model_precision?: "float64" | "float32"
  checkpoint_data?: boolean
}
export interface TrainingResumePlan {
  source_run_id: string
  source_dir: string
  from_stage: string
  methods: ("dtw" | "pca")[]
  reused_steps: string[]
  restored_steps: string[]
  computed_steps: string[]
  stages: string[]
  warnings: string[]
  model_summary: Partial<ModelInfo["summary"]>
  config: SimedapeConfig
  stage_params: Record<string, Record<string, unknown>>
  checkpoint_data: boolean
  saved_dtw_directory?: string | null
}
export const planTrainingResume = (runId: string, options: TrainingResumeOptions = {}) =>
  apiFetch<TrainingResumePlan>(`/api/runs/${encodeURIComponent(runId)}/resume-plan`, { method: "POST", body: JSON.stringify(options) })
export const resumeTraining = (runId: string, options: TrainingResumeOptions = {}) =>
  apiFetch<{ run_id: string; output_dir: string; plan: TrainingResumePlan }>(`/api/runs/${encodeURIComponent(runId)}/resume`, { method: "POST", body: JSON.stringify(options) })

export interface Artifact {
  name: string
  kind: string
  [key: string]: unknown
}

export interface EstimationOverview {
  run_id: string
  prefix: string
  methods: Record<
    string,
    {
      file: string
      metrics: Record<
        string,
        {
          count: number
          min: number | null
          max: number | null
          mean: number | null
        }
      >
      scalars: Record<string, unknown>
    }
  >
}

export interface ComparisonMatrix {
  run_id: string
  prefix: string
  methods: string[]
  metrics: { key: string; label: string }[]
  mape: Record<string, Record<string, number | null>>
  aggregate_error_pct: Record<string, Record<string, number | null>>
  coverage_pct: Record<string, number | null>
  n_real: Record<string, number | null>
  n_estimated: Record<string, number | null>
  /** metric -> stat -> method -> value (wape, smape, median_ape, bias_pct, rmse, mae, pearson, spearman) */
  robust?: Record<string, Record<string, Record<string, number | null>>>
  pairing?: Record<string, string | null>
}
export interface ComparisonDetail {
  label: string
  n_real: number
  n_estimated: number
  n_paired: number
  coverage_pct: number
  pairing: string
  aggregate: { real: Record<string, number | null>; estimated: Record<string, number | null>; error_pct: Record<string, number | null> }
  per_series_error: Record<string, Record<string, number | null>>
  robust?: Record<string, Record<string, number | null>>
  specific?: {
    worst: Record<string, { label: string; real: number; estimated: number; error_pct: number }[]>
    scatter: Record<string, [number, number][]>
    breakdowns: Record<string, Record<string, Record<string, { n: number; wape: number | null; bias_pct: number | null; median_ape: number | null }>>>
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const body = await res.json()
      msg = (body as { error?: string }).error ?? msg
    } catch {
      // ignore parse error
    }
    throw new Error(msg)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export const getSimedapeHealth = () => apiFetch<SimedapeHealth>("/api/health")

export interface SelectionScheduling {
  job_parallelism: number
  selection_parallelism: number
  selection_max_parallelism: number
  exclusive_selection_lane: boolean
}
export const getSelectionScheduling = () => apiFetch<SelectionScheduling>("/api/jobs/scheduling")
export const setSelectionScheduling = (selection_parallelism: number) => apiFetch<SelectionScheduling>("/api/jobs/scheduling", {
  method: "PUT", body: JSON.stringify({ selection_parallelism }),
})


export const getStages = () => apiFetch<StageInfo[]>("/api/stages")

export const getConfigs = () => apiFetch<NamedConfig[]>("/api/configs")

export const saveConfig = (name: string, config: Record<string, unknown>) =>
  apiFetch<NamedConfig>("/api/configs", {
    method: "POST",
    body: JSON.stringify({ name, config }),
  })

/** Simulations stored in ClickHouse; `config` picks a saved config's connection settings. */
export const getSimulations = (config?: string) =>
  apiFetch<SimulationsResponse>(
    `/api/simulations${config ? `?config=${encodeURIComponent(config)}` : ""}`
  )

export const listRuns = () => apiFetch<RunSummary[]>("/api/runs")

export const getRun = async (runId: string): Promise<RunSummary> => {
  const run = await apiFetch<Omit<RunSummary, "logs"> & { logs?: string | string[] }>(`/api/runs/${encodeURIComponent(runId)}`)
  // Older Scala services return individual log entries; Python returns text.
  return { ...run, logs: Array.isArray(run.logs) ? run.logs.join("\n") : run.logs }
}

export const getRunMetrics = (runId: string) => apiFetch<RunMetrics>(`/api/runs/${encodeURIComponent(runId)}/metrics`)
export const runMetricsDownloadUrl = (runId: string) => `${apiBase()}/api/runs/${encodeURIComponent(runId)}/metrics?download=1`

export const getRunProgress = (runId: string) =>
  apiFetch<RunProgressResponse>(
    `/api/runs/${encodeURIComponent(runId)}/progress`
  )

export const startRun = (body: RunStartBody) =>
  apiFetch<{ run_id: string }>("/api/runs", {
    method: "POST",
    body: JSON.stringify(body),
  })

/** Only queued runs can be cancelled; started runs answer 409. */
export const cancelRun = (runId: string) =>
  apiFetch<{ run_id: string; status: "cancelled" }>(
    `/api/runs/${encodeURIComponent(runId)}`,
    { method: "DELETE" }
  )

export const getRunArtifacts = (runId: string) =>
  apiFetch<{
    run_id: string
    output_dir: string | null
    artifacts: Artifact[]
  }>(`/api/runs/${encodeURIComponent(runId)}/artifacts`)

// --- Trained model file (model.simedape) ---
export interface ModelInfo {
  run_id: string
  file: string
  file_bytes: number
  format: string
  created: string
  meta: Record<string, unknown>
  summary: {
    n_series: number
    n_clusters: number
    cluster_sizes: number[]
    series_length: number
    simulation_points: number
    methods: ("dtw" | "pca")[]
    dtw: { clusters: number; paths: number; mean_path_length: number; settings?: { algorithm: "exact" | "fastdtw"; radius?: number } } | null
    pca: { centering?: "cluster_mean" | "simulation_point"; spectrum_measure?: "centred_variance" | "residual_energy"; clusters: number; n_components: number; explained_variance_pct_mean: number | null; selection?: PcaTrainingSettings | null; per_cluster?: { cluster: number; n_components: number; explained_variance_pct: number | null; target_met: boolean | null }[] } | null
  }
  total_raw_bytes: number
  total_stored_bytes: number
  /** Per group (clustering, dtw, pca, json): members, bytes before and after compression. */
  components: Record<string, { members: number; raw_bytes: number; stored_bytes: number }>
}
export const getRunModel = (runId: string) =>
  apiFetch<ModelInfo>(`/api/runs/${encodeURIComponent(runId)}/model`)
/** Server-built (matplotlib) results for a run: vector PDF, LaTeX tables, zip for an article. */
export const reportUrl = (runId: string, kind: "pdf" | "latex" | "zip", params: Record<string, string | number> = {}) => {
  const path = { pdf: "report.pdf", latex: "latex", zip: "export.zip" }[kind]
  const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()
  return `${apiBase()}/api/runs/${encodeURIComponent(runId)}/${path}${query ? `?${query}` : ""}`
}
export const modelDownloadUrl = (runId: string) =>
  `${apiBase()}/api/runs/${encodeURIComponent(runId)}/model/download`

// --- Clustering report (stored inside the model) ---
export interface ReportStats { mean: number; median: number; p90: number; max: number }
export interface ReportMember { index: number; label: string | null; distance: number; rmse: number }
export interface ClusterReportRow {
  cluster: number
  size: number
  pct: number
  distance: ReportStats
  rmse: ReportStats
  rel_error_pct: ReportStats
  mean_level: number
  histogram: { counts: number[]; edges: number[] }
  nearest_cluster: number | null
  nearest_cluster_distance: number | null
  near: ReportMember[]
  far: ReportMember[]
  dtw_distance?: ReportStats
  pca_unexplained_pct?: number
}
export interface ClusteringReport {
  run_id: string
  report: {
    n_series: number
    n_clusters: number
    series_length: number
    top: number
    inertia: number
    overall: { distance: ReportStats; rmse: ReportStats; rel_error_pct: ReportStats }
    clusters: ClusterReportRow[]
  }
  centroid_distance: number[][]
  cluster?: {
    cluster: number
    centroid: number[]
    near: (ReportMember & { series: number[] })[]
    far: (ReportMember & { series: number[] })[]
  }
}
export const getClusteringReport = (runId: string, cluster?: number, near = 5, far = 5) =>
  apiFetch<ClusteringReport>(
    `/api/runs/${encodeURIComponent(runId)}/clustering-report` + (cluster === undefined ? "" : `?cluster=${cluster}&near=${near}&far=${far}`)
  )

export const getRunEstimation = (runId: string) =>
  apiFetch<EstimationOverview>(
    `/api/runs/${encodeURIComponent(runId)}/estimation`
  )

export const getRunComparisonDetail = (runId: string, method: string) =>
  apiFetch<ComparisonDetail & { run_id: string }>(`/api/runs/${encodeURIComponent(runId)}/comparison?method=${encodeURIComponent(method)}`)
export const getRunComparison = (runId: string) =>
  apiFetch<ComparisonMatrix>(
    `/api/runs/${encodeURIComponent(runId)}/comparison`
  )

export interface NativeCatalogue {
  engine_ready: boolean
  live?: { configured: boolean; ready: boolean; reason: string | null }
  scenarios: {
    name: string
    title: string
    supported: boolean
    reason: string | null
    end_seconds?: number
    map_mode?: "standalone" | "osm"
    simulation_modes?: ("MICRO" | "MESO")[]
    location?: string
    location_label?: string
    location_kind?: LocationKind
    format?: string
    requires_fetch?: boolean
  }[]
}

// --- Simulation locations (htc-locations registry; see htc-locations/README.md) ---
export type LocationKind = "local" | "docker" | "ssh" | "gcs" | "clickhouse"
export type LocationRole = "input" | "output" | "both"
export interface SimLocation {
  id: string
  kind: LocationKind
  path: string
  label?: string
  container_path?: string
  host?: string
  user?: string
  port?: number
  role?: LocationRole
  database?: string
  table?: string
  secure?: boolean
  /** Name of the environment variable (on the API server) that holds the ClickHouse password. */
  password_env?: string
}
export interface LocationScenario {
  ref: string
  name: string
  title: string
  format: string
  map_mode: string
  duration: number | null
  size_bytes: number | null
  issues: string[]
}
export interface BrowseResult {
  path: string
  root: string
  parent: string | null
  is_scenario: boolean
  scenarios: number
  truncated: boolean
  entries: { name: string; path: string; scenarios: number; is_scenario: boolean }[]
}
export interface LocationSuggestion extends SimLocation {
  description: string
  scenarios: number
}
export const getLocationSuggestions = () =>
  apiFetch<{ suggestions: LocationSuggestion[] }>("/api/locations/suggestions")
// --- Engines (running HTC engines HTC View can drive) ---
export type EngineKind = "local" | "docker" | "vm" | "gke" | "other"
export interface SimEngine {
  id: string
  url: string
  kind?: EngineKind
  label?: string
  /** Input location this engine reads scenarios from (restricts the scenario picker). */
  location?: string
  /** Informational: nodes behind this control endpoint. */
  nodes?: number
}
export const listEngines = () => apiFetch<{ engines: SimEngine[] }>("/api/engines")
export const addEngine = (engine: SimEngine, replace = false) =>
  apiFetch<SimEngine>("/api/engines", {
    method: "POST",
    body: JSON.stringify({ ...engine, replace }),
  })
export const removeEngine = (id: string) =>
  apiFetch<void>(`/api/engines/${encodeURIComponent(id)}`, { method: "DELETE" })
export const getAllScenarios = (engineId?: string) =>
  apiFetch<{
    scenarios: (LocationScenario & {
      location_id: string
      location_label: string
      location_kind: LocationKind
    })[]
    errors: { location: string; error: string }[]
    restricted_to: string | null
  }>(`/api/scenarios${engineId ? `?engine=${encodeURIComponent(engineId)}` : ""}`)
/** Path of `ref` as the engine sees it (container / shared mount). */
export const getEnginePath = (ref: string) =>
  apiFetch<{ ref: string; engine_path: string }>(
    `/api/scenarios/engine-path?ref=${encodeURIComponent(ref)}`
  )
// --- Sweep (variations over several partial scenarios) ---
export interface SweepTable {
  run_id: string
  scenarios: { label: string; percentage: number | null }[]
  methods: string[]
  metrics: { key: string; label: string }[]
  /** metric -> method -> value per scenario (same order as `scenarios`) */
  mape: Record<string, Record<string, (number | null)[]>>
  error_pct: Record<string, Record<string, (number | null)[]>>
  coverage_pct: Record<string, (number | null)[]>
}
export const getRunSweep = (runId: string) => apiFetch<SweepTable>(`/api/runs/${encodeURIComponent(runId)}/sweep`)

// --- Estimation variants (DTW, PCA, PCA delta) ---
export interface EstimationVariant {
  key: string
  family: "dtw" | "pca" | "pca_delta"
  method: string
  interp: string | null
  eig: boolean
  label: string
  help: string
}
export const getEstimationVariants = () =>
  apiFetch<{ interpolations: string[]; default: string[]; variants: EstimationVariant[] }>("/api/estimation-variants")

// --- Partial simulation ---
export interface PartialConfigResult {
  ref: string
  /** "partial" (selection, maybe modifications) or "modified" (full run of the altered scenario). */
  kind: "partial" | "modified"
  modifications: { files: string[] } | null
  file: string
  /** Id the partial run reports under (simulation_id / report folder). */
  simulation_id: string
  /** Path of simulation.partial.json as the ENGINE sees it. */
  engine_path: string
  partial: { selectionFile: string; filterableClasses: string[]; reportFile?: string } | null
  problems: string[]
  note: string | null
}
export const createPartialConfig = (body: { ref: string; selection_file?: string; filterable_classes?: string[]; report_file?: string; modification_files?: string[] }) =>
  apiFetch<PartialConfigResult>("/api/scenarios/partial-config", { method: "POST", body: JSON.stringify(body) })
export interface PartialReport {
  actors_scanned: number
  filterable_actors: number
  selected_units: number
  kept: number
  removed: number
  kept_by_reason: Record<string, number>
  kept_by_class: Record<string, Record<string, number>>
  selected_not_found: number[]
  non_numeric_units: string[]
  filterable_classes: string[]
}
export const getPartialReport = (selection: string) =>
  apiFetch<PartialReport>(`/api/partial/report?selection=${encodeURIComponent(selection)}`)

// --- Scenario modifications (htc.modifications.v1) ---
export type ModOp = Record<string, unknown> & { op: string }
export interface Modifications {
  schema: "htc.modifications.v1"
  name?: string
  description?: string
  operations: ModOp[]
}
export interface ModificationsReport {
  ok: boolean
  errors: string[]
  warnings: string[]
  operations: { index: number; op: string | null; matches: number | null; sample: number[]; notes: string[] }[]
  summary: { actors_in_base: number; max_id: number; added: number; removed: number; affected_by_op: Record<string, number>; operations: number }
}
export const listModificationFiles = (ref: string) =>
  apiFetch<{ ref: string; files: string[] }>(`/api/modifications?ref=${encodeURIComponent(ref)}`)
export const readModificationFile = (ref: string, name: string) =>
  apiFetch<{ content: Modifications }>(`/api/modifications/file?ref=${encodeURIComponent(ref)}&name=${encodeURIComponent(name)}`)
export const writeModificationFile = (ref: string, name: string, content: Modifications) =>
  apiFetch<{ path: string }>("/api/modifications/file", { method: "PUT", body: JSON.stringify({ ref, name, content }) })
export type ModificationsFilesReport = ModificationsReport & { operations: (ModificationsReport["operations"][number] & { file?: string; file_index?: number })[] }
export const validateModificationFiles = (ref: string, files: string[]) =>
  apiFetch<ModificationsFilesReport>("/api/modifications/validate", { method: "POST", body: JSON.stringify({ ref, files }) })
export const validateModifications = (ref: string, content: unknown) =>
  apiFetch<ModificationsReport>("/api/modifications/validate", { method: "POST", body: JSON.stringify({ ref, content }) })

// --- Actor descriptors (JSON Schema + x-htc-*) ---
export interface FieldInfo {
  path: string
  type: string
  types: string[]
  label: string
  unit: string | null
  group: string | null
  help: string | null
  enum: (string | number)[] | null
  ref: string | null
  widget: string | null
  editable: boolean
  minimum: number | null
  exclusiveMinimum: number | null
  /** Columns of a table-widget field (array of objects). */
  items: ItemColumn[] | null
}
export interface ItemColumn {
  name: string
  label: string
  unit: string | null
  types: string[]
  type: string
  nullable: boolean
  enum: (string | number)[] | null
  ref: string | null
  required: boolean
  minimum: number | null
  exclusiveMinimum: number | null
}
export interface ActorDependencySpec { name: string; class: string; required: boolean; relation: string; note?: string }
export interface ActorSchema {
  title: string
  description?: string
  "x-htc-class": string
  "x-htc-filterable": boolean
  "x-htc-dependencies": ActorDependencySpec[]
  properties?: { data?: { properties?: { dataType?: { const?: string } } } }
}
export interface ActorSchemas {
  version: number
  actors: Record<string, ActorSchema>
  catalog: Record<string, FieldInfo[]>
}
export const getActorSchemas = () => apiFetch<ActorSchemas>("/api/schemas")
export type ScenarioActor = {
  id: number
  typeActor: string
  data: { dataType: string; content: Record<string, unknown> }
  dependencies?: Record<string, { id: number; classType: string; relation?: string }>
} & Record<string, unknown>
export const readScenarioActor = (ref: string, id: number) =>
  apiFetch<{ actor: ScenarioActor }>(`/api/modifications/actor?ref=${encodeURIComponent(ref)}&id=${id}`)

// --- Scenario simulation.json editor ---
export type ScenarioConfig = Record<string, unknown>
export interface ScenarioConfigDoc {
  ref: string
  path: string
  config: ScenarioConfig
  sha256: string
  writable: boolean
  problems: string[]
  location_kind: LocationKind
}
export const getScenarioConfig = (ref: string) =>
  apiFetch<ScenarioConfigDoc>(
    `/api/scenarios/config?ref=${encodeURIComponent(ref)}`
  )
export const saveScenarioConfig = (
  ref: string,
  config: ScenarioConfig,
  sha256: string
) =>
  apiFetch<{ path: string; backup: string; sha256: string }>(
    "/api/scenarios/config",
    { method: "PUT", body: JSON.stringify({ ref, config, sha256 }) }
  )
/** The config with file paths relocated to where the engine sees the scenario. */
export const getEngineConfig = (ref: string, config: ScenarioConfig) =>
  apiFetch<{ config: ScenarioConfig }>("/api/scenarios/engine-config", {
    method: "POST",
    body: JSON.stringify({ ref, config }),
  })
// --- Engine settings catalog (parsed from the engine's application.conf) ---
export type EngineSettingScope = "env" | "hocon" | "internal"
export interface EngineSettingDef {
  path: string
  /** Literal default as written in application.conf. */
  default: string
  type: "bool" | "int" | "float" | "duration" | "list" | "string" | "other"
  /** Environment variable that overrides it; empty when the file has none. */
  env: string
  description: string
  context: string
  group: string
  scope: EngineSettingScope
  /** Closed value set (radio/select); for type "list" it is a multi-choice (checkboxes). */
  options?: string[]
}
export type ExportFormat = "env" | "compose" | "k8s" | "hocon" | "jvm"
export const getEngineSettings = () =>
  apiFetch<{
    source: string
    sha256: string
    counts: Partial<Record<EngineSettingScope, number>>
    settings: EngineSettingDef[]
  }>("/api/engine-settings")
export interface EngineStartupProfile {
  configured: boolean
  path: string | null
  overrides: Record<string, string>
  configFiles: string[]
  configResource: string
  configResources: string[]
  restartRequired: boolean
}
export const getEngineStartupProfile = () => apiFetch<EngineStartupProfile>("/api/engine-settings/profile")
export const saveEngineStartupProfile = (overrides: Record<string, string>, configFiles?: string[], configResource?: string) =>
  apiFetch<EngineStartupProfile>("/api/engine-settings/profile", {
    method: "PUT", body: JSON.stringify({ overrides, configFiles, configResource }),
  })
export const exportEngineSettings = (
  format: ExportFormat,
  overrides: Record<string, string>,
  configResource = "application.conf"
) =>
  apiFetch<{ format: ExportFormat; text: string }>(
    "/api/engine-settings/export",
    { method: "POST", body: JSON.stringify({ format, overrides, configResource }) }
  )
export const browseFolders = (path?: string) =>
  apiFetch<BrowseResult>(
    `/api/fs/browse${path ? `?path=${encodeURIComponent(path)}` : ""}`
  )
export const listLocations = (role?: "input" | "output") =>
  apiFetch<{ registry: string; locations: SimLocation[] }>(
    `/api/locations${role ? `?role=${role}` : ""}`
  )
export const addLocation = (loc: SimLocation, replace = false) =>
  apiFetch<SimLocation>("/api/locations", {
    method: "POST",
    body: JSON.stringify({ ...loc, replace }),
  })
export const removeLocation = (id: string) =>
  apiFetch<void>(`/api/locations/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
export const testLocation = (id: string) =>
  apiFetch<{ id: string; ok: boolean; status?: string; error?: string }>(
    `/api/locations/${encodeURIComponent(id)}/test`
  )
export interface StoredSimulation {
  simulation_id: string
  links?: number
  events?: number
  size_bytes?: number
  paths?: string[]
}
export const deleteLocationSimulation = (id: string, simulationId: string) =>
  apiFetch<{ deleted: string; note?: string }>(`/api/locations/${encodeURIComponent(id)}/simulations`, {
    method: "DELETE",
    body: JSON.stringify({ simulation_id: simulationId, confirm: true }),
  })
export const getLocationSimulations = (id: string) =>
  apiFetch<{ location: string; simulations: StoredSimulation[] }>(
    `/api/locations/${encodeURIComponent(id)}/simulations`
  )
export const getLocationScenarios = (id: string) =>
  apiFetch<{ location: string; scenarios: LocationScenario[] }>(
    `/api/locations/${encodeURIComponent(id)}/scenarios`
  )

export interface NativeResults {
  replay?: {
    scenario_id: string
    descriptor_url: string
    available: boolean
    reason: string | null
  }
  observation_semantics: string
  simulation_modes?: ("MICRO" | "MESO")[]
  measurement_notes?: Record<string, string>
  variables: string[]
  variable_units: Record<string, string>
  series: { index: number; label: string }[]
  observed_values: number
  total_values: number
  completion_evidence: string
  artifacts: string[]
}

export interface NativeSeries {
  label: string
  variable: string
  unit: string
  times: number[]
  values: (number | null)[]
  observed: boolean[]
}

export const getNativeCatalogue = () =>
  apiFetch<NativeCatalogue>("/api/htc/scenarios")
export const startNativeRun = (scenario: string, bin_seconds: number, live = false) =>
  apiFetch<{ run_id: string; live_url?: string | null }>("/api/htc/runs", {
    method: "POST",
    body: JSON.stringify({ scenario, bin_seconds, live }),
  })
export const getNativeSeries = (
  runId: string,
  series: number,
  variable: string
) =>
  apiFetch<NativeSeries>(
    `/api/runs/${encodeURIComponent(runId)}/native/series?series=${series}&variable=${encodeURIComponent(variable)}`
  )
export const nativeArtifactUrl = (runId: string, filename: string) =>
  `${apiBase()}/api/runs/${encodeURIComponent(runId)}/native/artifacts/${encodeURIComponent(filename)}`
