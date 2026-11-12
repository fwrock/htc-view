/**
 * HTC Simulator REST API client
 * Communicates with the hyperbolic-time-chamber HTTP API.
 *
 * Configure the base URL via NEXT_PUBLIC_HTC_API_URL (default: http://localhost:9804/api/v1).
 */

const DEFAULT_BASE_URL =
  process.env.NEXT_PUBLIC_HTC_API_URL ?? "http://localhost:9804/api/v1"

// The engine this page talks to is chosen at runtime (Simulator → engine selector, backed by the
// htc-locations registry). Falls back to NEXT_PUBLIC_HTC_API_URL.
let baseUrl = DEFAULT_BASE_URL
export const getHtcApiBase = () => baseUrl
export function setHtcApiBase(url: string | null | undefined) {
  baseUrl = (url || DEFAULT_BASE_URL).replace(/\/+$/, "")
}

/** Reachability check from the browser (the path the page itself uses); never throws. */
export async function probeEngine(
  url: string,
  timeoutMs = 4000
): Promise<
  | { ok: true; simulationStatus: SimulationStatus | string }
  | { ok: false; reason: string }
> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/health`, {
      signal: ctrl.signal,
    })
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` }
    const body = (await res.json()) as Partial<HealthResponse>
    return { ok: true, simulationStatus: body.simulationStatus ?? "Idle" }
  } catch (e) {
    return {
      ok: false,
      reason:
        (e as Error).name === "AbortError"
          ? `sem resposta em ${timeoutMs / 1000}s`
          : "conexão recusada ou bloqueada (CORS/rede)",
    }
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SimulationStatus =
  | "Idle"
  | "Loading"
  | "Running"
  | "Paused"
  | "Stopped"
  | "Failed"
  | "Resetting"

export type SettingSource = "api_override" | "env_var" | "application_conf"
export type ConfigSource = "api_override" | "file_or_env" | "none"

export interface HealthResponse {
  status: "ok" | string
  simulationStatus: SimulationStatus
  apiConfigLoaded: boolean
}

export interface StatusResponse {
  simulationId?: string | null
  status: SimulationStatus
  currentTick: number
  progressRatio: number
  apiConfigLoaded: boolean
  settingOverrides: number
  timeManagerType?: string
  gvt?: number | null
}

export interface SimulationConfig {
  name: string
  description?: string
  startTick?: number
  duration: number
  timeUnit?: string
  timeStep?: number
  startRealTime?: string
  actorsDataSources?: unknown[]
}

export interface ConfigResponse {
  source: ConfigSource
  config: SimulationConfig | null
}

export interface Setting {
  key: string
  envVar: string
  description?: string
  defaultValue: string
  currentValue: string
  source: SettingSource
  type?: "string" | "number" | "boolean" | "list" | "object" | "null"
  options?: string[] | null
  overridden?: boolean
  restartRequired?: boolean
}

export interface SettingsResponse {
  settings: Setting[]
}

export const getDispatcherSettings = () => apiFetch<{ settings: Record<string, string>; restartRequired: boolean }>("/dispatchers")

export interface StartBody {
  configFile?: string
  settings?: Record<string, string>
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

export interface ScenarioMeta {
  description?: string | null
  version?: string | null
  author?: string | null
  tags?: string[] | null
  notes?: string | null
}

export interface ScenarioSummary {
  name: string
  hasMetadata: boolean
  meta: ScenarioMeta | null
  simulationName: string | null
  simulationDescription: string | null
  duration: number | null
  timeUnit: string | null
  startTick: number | null
  endTick: number | null
}

export interface ScenariosListResponse {
  scenariosDir: string
  count: number
  scenarios: ScenarioSummary[]
}

export interface ScenarioDetailResponse {
  name: string
  hasMetadata: boolean
  meta: ScenarioMeta | null
  simulation: SimulationConfig
}

export interface ScenarioLoadResponse {
  status: string
  message: string
  name: string
  simulationName: string
}

// ---------------------------------------------------------------------------
// Internal fetch helper
// ---------------------------------------------------------------------------

async function apiFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const url = `${baseUrl}${path}`
  const res = await fetch(url, {
    ...init,
    headers: (() => {
      const headers = new Headers(init?.headers)
      if (init?.body != null && !headers.has("Content-Type")) headers.set("Content-Type", "application/json")
      return headers
    })(),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(
      `HTC API ${init?.method ?? "GET"} ${path} → ${res.status}: ${body}`
    )
  }

  // 204 No Content
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export function getHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>("/health")
}

// ---------------------------------------------------------------------------
// Simulation status
// ---------------------------------------------------------------------------

export function getSimulationStatus(): Promise<StatusResponse> {
  return apiFetch<StatusResponse>("/simulation/status")
}

// ---------------------------------------------------------------------------
// Simulation config
// ---------------------------------------------------------------------------

export function getSimulationConfig(): Promise<ConfigResponse> {
  return apiFetch<ConfigResponse>("/simulation/config")
}

export function putSimulationConfig(
  config: SimulationConfig
): Promise<{ status: string; name: string }> {
  return apiFetch("/simulation/config", {
    method: "PUT",
    body: JSON.stringify(config),
  })
}

export function deleteSimulationConfig(): Promise<{
  status: string
  message: string
}> {
  return apiFetch("/simulation/config", { method: "DELETE" })
}

// ---------------------------------------------------------------------------
// Simulation lifecycle
// ---------------------------------------------------------------------------

export function startSimulation(
  body?: StartBody
): Promise<{ status: string; message: string; simulationId?: string }> {
  return apiFetch("/simulation/start", {
    method: "POST",
    body: body ? JSON.stringify(body) : undefined,
  })
}

export function pauseSimulation(): Promise<{ status: string; message: string }> {
  return apiFetch("/simulation/pause", { method: "POST" })
}

export function resumeSimulation(): Promise<{
  status: string
  message: string
}> {
  return apiFetch("/simulation/resume", { method: "POST" })
}

export function stopSimulation(): Promise<{ status: string; message: string }> {
  return apiFetch("/simulation/stop", { method: "POST" })
}

export function resetSimulation(): Promise<StatusResponse> {
  return apiFetch("/simulation/reset", { method: "POST" })
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function getSettings(): Promise<SettingsResponse> {
  return apiFetch<SettingsResponse>("/settings")
}

export function getSetting(key: string): Promise<Setting> {
  return apiFetch<Setting>(`/settings/${encodeURIComponent(key)}`)
}

export function putSettings(
  overrides: Record<string, string>
): Promise<{ status: string; updated: number }> {
  return apiFetch("/settings", {
    method: "PUT",
    body: JSON.stringify(overrides),
  })
}

export function putSetting(
  key: string,
  value: string
): Promise<{ status: string; key: string; value: string }> {
  return apiFetch(`/settings/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: value,
    headers: { "Content-Type": "text/plain" },
  })
}

export function deleteSettings(): Promise<{ status: string; message: string }> {
  return apiFetch("/settings", { method: "DELETE" })
}

export function deleteSetting(
  key: string
): Promise<{ status: string; message: string }> {
  return apiFetch(`/settings/${encodeURIComponent(key)}`, { method: "DELETE" })
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

export function getScenarios(): Promise<ScenariosListResponse> {
  return apiFetch<ScenariosListResponse>("/scenarios")
}

export function getScenario(name: string): Promise<ScenarioDetailResponse> {
  return apiFetch<ScenarioDetailResponse>(`/scenarios/${encodeURIComponent(name)}`)
}

export function loadScenario(name: string): Promise<ScenarioLoadResponse> {
  return apiFetch<ScenarioLoadResponse>(
    `/scenarios/${encodeURIComponent(name)}/load`,
    { method: "POST" }
  )
}
