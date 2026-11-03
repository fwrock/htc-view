/**
 * Experiments API client (simedape/api/experiments.py). A descriptor (htc.experiment.v1) is edited here and
 * validated/planned/run by the same orchestrator the `htc-experiment` CLI uses; this file holds no experiment logic.
 */

const BASE_URL = process.env.NEXT_PUBLIC_SIMEDAPE_API_URL ?? "http://localhost:5000"

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json }
export type Descriptor = {
  schema: "htc.experiment.v1"
  name: string
  description?: string
  vars?: Record<string, Json>
  matrix?: Record<string, Json[]>
  profiles?: Record<string, Record<string, Json>>
  environment: Record<string, Json>
  steps: StepDef[]
}
export type StepDef = {
  id: string
  type: string
  needs?: string[]
  matrix?: string[]
  params?: Record<string, Json>
  enabled?: boolean
  timeout_s?: number
  retries?: number
  on_failure?: "fail" | "continue"
}

export type Problem = { path: string; message: string }
export type PlanInstance = {
  id: string
  step: string
  type: string
  axes: Record<string, Json>
  needs: string[]
  key: string
  params: Record<string, Json>
}
export type PlanPhase = { phase: string; active: boolean; hooks: string[]; overridden: boolean; creates_billable_infrastructure?: boolean; destroys?: string }
export type Plan = {
  name: string
  counts: Record<string, number>
  instances: PlanInstance[]
  order: string[]
  warnings: string[]
  environment: {
    kind: string
    label: string
    engine: string
    nodes: number
    teardown_policy: string
    ttl_minutes: number
    phases: PlanPhase[]
    destructive: string[]
    requires_confirmation: boolean
  }
}
export type ValidateResult = { valid: true; plan: Plan } | { valid: false; problems: Problem[] }

export type SchemaProp = { type?: string; description?: string; enum?: Json[]; items?: { enum?: Json[]; type?: string }; default?: Json; minimum?: number; maximum?: number; const?: Json }
export type ExperimentSchema = {
  properties: {
    environment: { properties: Record<string, SchemaProp> }
    steps: { items: { oneOf: { title: string; properties: { type: { const: string }; params: { properties: Record<string, SchemaProp>; required?: string[] } } }[] } }
  }
  "x-htc-help": HelpBundle
  "x-htc-phases": string[]
  "x-htc-hook-phases": string[]
  "x-htc-env-fields": Record<string, string[]>
  "x-htc-billable-kinds": string[]
}

export type ExperimentsStatus = { available: boolean; run_enabled: boolean; directory: string; hint: string | null; defaults: Record<string, string> }

export type HelpBundle = {
  steps: Record<string, { summary: string; needs: string; produces: string; tip: string }>
  environments: Record<string, { summary: string; needs: string[]; cost: string }>
  phases: Record<string, string>
  fields: Record<string, { example?: string; hint?: string }>
}

export type TemplateVar = {
  name: string
  label: string
  help: string
  kind: "text" | "number" | "numbers" | "list" | "choice" | "path" | "file" | "dir" | "scenario" | "clickhouse"
  required: boolean
  default?: Json
  example?: string
  choices?: { value: Json; label: string; help: string }[]
  when?: Record<string, Json[]>
}
export type TemplateInfo = {
  id: string
  title: string
  summary: string
  when: string[]
  needs: string[]
  verified: "verificado" | "parcial" | "nao-executavel"
  verified_note: string
  variables: TemplateVar[]
}
export type RunStatus = "starting" | "pending" | "running" | "succeeded" | "failed" | "cancelled" | "lost"
export type RunSummary = {
  id: string
  name: string
  status: RunStatus
  alive: boolean
  counts: Record<string, number>
  total: number
  started: number | null
  finished: number | null
  environment: string
  exit_code: number | null
  error: string
}
export type InstanceState = { status: string; key?: string; type?: string; error?: string; reason?: string; attempt?: number; started?: number; finished?: number }
export type RunDetail = {
  summary: RunSummary
  plan: Plan | null
  state: { name: string; status: string; instances: Record<string, InstanceState>; warnings?: string[]; error?: string } | null
  outputs: Record<string, Record<string, Json>>
  descriptor: Descriptor | null
}

export class ApiError extends Error {
  status: number
  body: { error?: string; problems?: Problem[]; destructive?: string[]; needs_confirmation?: boolean }
  constructor(status: number, body: ApiError["body"]) {
    super(body.error ?? `HTTP ${status}`)
    this.status = status
    this.body = body
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { headers: { "Content-Type": "application/json" }, ...init })
  if (!res.ok) {
    let body: ApiError["body"] = {}
    try {
      body = await res.json()
    } catch {
      /* no body */
    }
    throw new ApiError(res.status, body)
  }
  return (await res.json()) as T
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) })

export const getExperimentsStatus = () => call<ExperimentsStatus>("/api/experiments/status")
export const getExperimentSchema = () => call<ExperimentSchema>("/api/experiments/schema")
export const getTemplates = () => call<{ templates: TemplateInfo[] }>("/api/experiments/templates")
export const renderTemplate = (id: string, values: Record<string, Json>) =>
  call<{ descriptor: Descriptor; valid: boolean; problems: Problem[] }>(`/api/experiments/templates/${encodeURIComponent(id)}/render`, post({ values }))
export const getExamples = () => call<{ examples: { name: string; description: string; descriptor: Descriptor }[] }>("/api/experiments/examples")
export const validateDescriptor = (descriptor: Descriptor, sets: string[] = []) =>
  call<ValidateResult>("/api/experiments/validate", post({ descriptor, sets }))

export type StartOptions = { sets?: string[]; name?: string; confirm_billable?: boolean; force?: boolean; keep_env?: boolean; only?: string[] }
export const startExperiment = (descriptor: Descriptor, opts: StartOptions = {}) =>
  call<{ id: string }>("/api/experiments/runs", post({ descriptor, ...opts }))
export const listExperimentRuns = () => call<{ runs: RunSummary[] }>("/api/experiments/runs")
export const getExperimentRun = (id: string) => call<RunDetail>(`/api/experiments/runs/${encodeURIComponent(id)}`)
export const listRunLogs = (id: string) => call<{ logs: string[] }>(`/api/experiments/runs/${encodeURIComponent(id)}/logs`)
export const cancelExperimentRun = (id: string) => call<{ message: string }>(`/api/experiments/runs/${encodeURIComponent(id)}/cancel`, post({}))
export const interruptExperimentRun = (id: string) => call<{ ok: boolean }>(`/api/experiments/runs/${encodeURIComponent(id)}/interrupt`, post({}))
export const deleteExperimentRun = (id: string) => call<{ ok: boolean }>(`/api/experiments/runs/${encodeURIComponent(id)}`, { method: "DELETE" })
export async function getRunLog(id: string, name: string, tail = 300): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/experiments/runs/${encodeURIComponent(id)}/logs/${encodeURIComponent(name)}?tail=${tail}`)
  if (!res.ok) throw new ApiError(res.status, { error: `HTTP ${res.status}` })
  return res.text()
}
export const artifactUrl = (id: string, path: string, download = false) =>
  `${BASE_URL}/api/experiments/runs/${encodeURIComponent(id)}/artifact?path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`

export const listSavedDescriptors = () => call<{ descriptors: { name: string; description: string; modified: number }[] }>("/api/experiments/descriptors")
export const getSavedDescriptor = (name: string) => call<{ descriptor: Descriptor }>(`/api/experiments/descriptors/${encodeURIComponent(name)}`)
export const saveDescriptor = (name: string, descriptor: Descriptor) =>
  call<{ ok: boolean }>(`/api/experiments/descriptors/${encodeURIComponent(name)}`, { method: "PUT", body: JSON.stringify({ descriptor }) })
export const deleteSavedDescriptor = (name: string) => call<{ ok: boolean }>(`/api/experiments/descriptors/${encodeURIComponent(name)}`, { method: "DELETE" })

export const NEW_DESCRIPTOR: Descriptor = {
  schema: "htc.experiment.v1",
  name: "novo-experimento",
  description: "",
  vars: {},
  matrix: {},
  environment: { kind: "local", jar: "${env:HTC_ENGINE_JAR}", port: 9830 },
  steps: [{ id: "treino", type: "train", params: { source: { csv: "/caminho/da/base" } } }],
}
