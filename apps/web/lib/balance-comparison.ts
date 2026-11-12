export interface BalanceSample { name: string; labels: Record<string, string>; value: number }
export interface BalanceObservation {
  ts: number; elapsedSeconds: number; status: { status?: string; currentTick?: number; progressRatio?: number } | null
  error: string | null; samples: BalanceSample[]
}
export interface BalanceRunMetadata {
  schemaVersion: number; id: string; scenario: string; configSha256: string; config: Record<string, unknown>
  runtimeSettings: Record<string, unknown>; startupOverrides: string; nodeCount: number; imageTag: string
  balancingEnabled: boolean; startedAt: number; endedAt: number | null; outcome: string
  sampleCount: number; failedSamples: number; storageErrors?: number; intervalSeconds: number
}
export interface BalanceRun { schemaVersion: number; metadata: BalanceRunMetadata; samples: BalanceObservation[] }

export function validateBalanceRun(value: unknown): BalanceRun {
  const run = value as BalanceRun
  if (!run || run.schemaVersion !== 1 || !run.metadata || typeof run.metadata.id !== "string" ||
      !Array.isArray(run.samples) || typeof run.metadata.scenario !== "string" || !Number.isFinite(run.metadata.startedAt))
    throw new Error("Unsupported run metrics file")
  let previous = -1
  for (const row of run.samples) {
    if (!Number.isFinite(row.ts) || !Number.isFinite(row.elapsedSeconds) || row.elapsedSeconds < previous || !Array.isArray(row.samples))
      throw new Error("Invalid observation order or timestamp")
    previous = row.elapsedSeconds
    for (const s of row.samples) {
      if (typeof s.name !== "string" || !s.labels || typeof s.labels !== "object" || !Number.isFinite(s.value) ||
          Object.values(s.labels).some(v => typeof v !== "string")) throw new Error("Invalid metric sample")
    }
  }
  return run
}
const key = (s: BalanceSample) => JSON.stringify([s.name, Object.entries(s.labels).sort(([a], [b]) => a.localeCompare(b))])
export function sumMetric(row: BalanceObservation, name: string, where: Record<string, string> = {}): number | null {
  const values = row.samples.filter(s => s.name === name && Object.entries(where).every(([k,v]) => s.labels[k] === v))
  return values.length ? values.reduce((n,s) => n+s.value, 0) : null
}
export function counterDelta(run: BalanceRun, name: string, where: Record<string, string> = {}): number | null {
  const previous = new Map<string, number>(); let amount = 0; let seen = false
  run.samples.forEach((row, i) => {
    for (const s of row.samples.filter(s => s.name === name && Object.entries(where).every(([k,v]) => s.labels[k] === v))) {
      const last = previous.get(key(s))
      if (i > 0) amount += last === undefined ? s.value : s.value >= last ? s.value-last : s.value
      previous.set(key(s), s.value); seen = true
    }
  })
  return seen ? amount : null
}
export function imbalance(row: BalanceObservation, source: "observed" | "actors" = "observed"): { cv: number | null; maxMean: number | null } {
  let loads = row.samples.filter(s => s.name === "htc_loadbalance_node_entities").map(s => s.value)
  if (source === "actors") {
    const actors = row.samples.filter(s => s.name === "htc_actors_active" && s.labels.node)
    const nodes = new Map(row.samples.filter(s => s.name === "htc_node_info" && s.labels.node).map(s => [s.labels.node!,0]))
    for (const s of actors) nodes.set(s.labels.node!, (nodes.get(s.labels.node!) ?? 0)+s.value)
    loads = actors.length ? [...nodes.values()] : []
  }
  if (!loads.length || row.error) return { cv: null, maxMean: null }
  const mean = loads.reduce((a,b)=>a+b,0)/loads.length
  if (!mean) return { cv: null, maxMean: null }
  return { cv: Math.sqrt(loads.reduce((n,v)=>n+(v-mean)**2,0)/loads.length)/mean, maxMean: Math.max(...loads)/mean }
}
export function strategyOf(run: BalanceRun): string {
  const values = [...new Set(run.samples.flatMap(row => row.samples.filter(s => s.name === "htc_loadbalance_strategy_info" && s.value > 0).map(s=>s.labels.strategy!)))]
  if (values.length) return values.join(", ")
  if (!run.metadata.balancingEnabled) return "disabled"
  return /(?:htc\.load-balance-manager\.strategy|strategy)\s*[=:]\s*"?([\w-]+)/.exec(run.metadata.startupOverrides)?.[1] ?? "not observed"
}
export function runSummary(run: BalanceRun) {
  const good = run.samples.filter(s=>!s.error)
  const final = good.at(-1)
  const cvs = good.map(s=>imbalance(s).cv).filter((v): v is number=>v !== null)
  const actorCVs = good.map(s=>imbalance(s,"actors").cv).filter((v):v is number=>v !== null)
  const heap = good.map(s=>sumMetric(s,"jvm_memory_bytes_used",{area:"heap"})).filter((v):v is number=>v !== null)
  const remote = counterDelta(run,"htc_messages_by_node_total",{locality:"remote"})
  const messages = counterDelta(run,"htc_messages_by_node_total")
  const migrationCount = counterDelta(run,"htc_loadbalance_migration_seconds_count")
  const migrationSum = counterDelta(run,"htc_loadbalance_migration_seconds_sum")
  const observed = final?.elapsedSeconds ?? null
  return { strategy: strategyOf(run), observedSeconds: observed, finalTick: final?.status?.currentTick ?? null,
    meanImbalanceCV: cvs.length ? cvs.reduce((a,b)=>a+b,0)/cvs.length : null,
    meanActorImbalanceCV: actorCVs.length ? actorCVs.reduce((a,b)=>a+b,0)/actorCVs.length : null,
    observedTicksPerSecond: observed && final?.status?.currentTick !== undefined ? final.status.currentTick/observed : null,
    peakHeapBytes: heap.length ? Math.max(...heap) : null,
    cpuSeconds: counterDelta(run,"process_cpu_seconds_total"),
    rebalanceEvaluations: counterDelta(run,"htc_loadbalance_rebalances_total"),
    plannedMigrations: counterDelta(run,"htc_loadbalance_migrations_planned_total"),
    completedMigrations: counterDelta(run,"htc_loadbalance_migrations_total",{outcome:"completed"}),
    skippedMigrations: counterDelta(run,"htc_loadbalance_migrations_total",{outcome:"skipped"}),
    meanMigrationSeconds: migrationCount && migrationSum !== null ? migrationSum/migrationCount : null,
    remoteMessageRatio: remote !== null && messages ? remote/messages : null,
    failedObservations: counterDelta(run,"htc_loadbalance_observations_total",{outcome:"failed"}),
    failedSamples: run.metadata.failedSamples, storageErrors: run.metadata.storageErrors ?? 0 }
}
export type ComparisonMetric = "tick" | "imbalance" | "actorImbalance" | "heap" | "cpu" | "migrations" | "remote"
export function comparisonSeries(run: BalanceRun, metric: ComparisonMetric): [number,number][] {
  const points: [number,number][] = []
  let previous: BalanceObservation | undefined
  for (const row of run.samples) {
    if (row.error) { previous = undefined; continue }
    let value: number | null = null
    if (metric === "tick") value = row.status?.currentTick ?? null
    if (metric === "actorImbalance") value = imbalance(row,"actors").cv
    if (metric === "imbalance") value = imbalance(row).cv
    if (metric === "heap") value = sumMetric(row,"jvm_memory_bytes_used",{area:"heap"})
    if (metric === "cpu" && previous) {
      const old = sumMetric(previous,"process_cpu_seconds_total"), current = sumMetric(row,"process_cpu_seconds_total")
      const dt = row.elapsedSeconds-previous.elapsedSeconds
      if (old !== null && current !== null && current >= old && dt > 0) value = (current-old)/dt
    }
    if (metric === "migrations") value = sumMetric(row,"htc_loadbalance_migrations_total",{outcome:"completed"})
    if (metric === "remote") value = sumMetric(row,"htc_messages_by_node_total",{locality:"remote"})
    if (value !== null) points.push([row.elapsedSeconds*1000,value])
    previous = row
  }
  return points
}
const cell = (v: unknown) => '"'+String(v ?? "").replaceAll('"','""')+'"'
export function comparisonCsv(runs: BalanceRun[]): string {
  const summaries = runs.map(run=>({runId:run.metadata.id, scenario:run.metadata.scenario, nodeCount:run.metadata.nodeCount,
    imageTag:run.metadata.imageTag, outcome:run.metadata.outcome, configSha256:run.metadata.configSha256, ...runSummary(run)}))
  if (!summaries.length) return ""
  const columns = Object.keys(summaries[0]!)
  return [columns.map(cell).join(","),...summaries.map(s=>columns.map(c=>cell(s[c as keyof typeof s])).join(","))].join("\r\n")+"\r\n"
}
export function samplesCsv(run: BalanceRun): string {
  const rows = [["run_id","elapsed_seconds","timestamp_ms","status","metric","labels","value","error"].map(cell).join(",")]
  for (const row of run.samples) {
    if (row.error) rows.push([run.metadata.id,row.elapsedSeconds,row.ts,row.status?.status,"","","",row.error].map(cell).join(","))
    for (const s of row.samples) rows.push([run.metadata.id,row.elapsedSeconds,row.ts,row.status?.status,s.name,JSON.stringify(s.labels),s.value,""].map(cell).join(","))
  }
  return rows.join("\r\n")+"\r\n"
}
