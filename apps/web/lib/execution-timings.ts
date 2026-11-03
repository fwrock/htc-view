/** Samples from one or several process-scoped Prometheus endpoints. */
export interface TimingSample {
  name: string
  labels: Record<string, string>
  value: number
}
export interface ExecutionTiming {
  operation: string
  node: string
  count: number
  failed: number
  totalSeconds: number
  elapsedSeconds: number
  active: number
  meanSeconds: number | null
  maxSeconds: number | null
  lastSeconds: number | null
}
const fields: Record<string, keyof ExecutionTiming> = {
  htc_execution_duration_seconds_count: "count",
  htc_execution_duration_seconds_sum: "totalSeconds",
  htc_execution_duration_max_seconds: "maxSeconds",
  htc_execution_duration_last_seconds: "lastSeconds",
  htc_execution_elapsed_seconds: "elapsedSeconds",
  htc_execution_active: "active",
  htc_execution_failed_total: "failed",
}

/** Keep nodes separate: summing simultaneous spans is accumulated wall time, not run duration. */
export function executionTimings(
  samples: readonly TimingSample[]
): ExecutionTiming[] {
  const rows = new Map<string, ExecutionTiming>()
  const hasElapsed = new Set<string>()
  for (const sample of samples) {
    const field = fields[sample.name]
    const operation = sample.labels.operation
    if (!field || !operation || !Number.isFinite(sample.value)) continue
    const node = sample.labels.node ?? ""
    const key = JSON.stringify([node, operation])
    let row = rows.get(key)
    if (!row) {
      row = {
        operation,
        node,
        count: 0,
        failed: 0,
        totalSeconds: 0,
        elapsedSeconds: 0,
        active: 0,
        meanSeconds: null,
        maxSeconds: null,
        lastSeconds: null,
      }
      rows.set(key, row)
    }
    if (field === "elapsedSeconds") hasElapsed.add(key)
    if (field === "maxSeconds" || field === "lastSeconds")
      row[field] = sample.value
    else if (
      field === "count" ||
      field === "failed" ||
      field === "totalSeconds" ||
      field === "active" ||
      field === "elapsedSeconds"
    )
      row[field] += sample.value
  }
  return [...rows.entries()]
    .map(([key, row]) => ({
      ...row,
      elapsedSeconds: hasElapsed.has(key)
        ? row.elapsedSeconds
        : row.totalSeconds,
      meanSeconds: row.count > 0 ? row.totalSeconds / row.count : null,
      maxSeconds: row.count > 0 ? row.maxSeconds : null,
      lastSeconds: row.count > 0 ? row.lastSeconds : null,
    }))
    .sort(
      (a, b) =>
        a.operation.localeCompare(b.operation) || a.node.localeCompare(b.node)
    )
}

export const TIMING_LABELS: Record<string, string> = {
  config_load: "Leitura da configuração",
  simulation_load: "Carga inicial da simulação",
  progressive_index: "Preparação da carga progressiva",
  progressive_load: "Carga de janelas progressivas",
  simulation_loop: "Loop da simulação",
  time_manager_synchronization: "Sincronização dos gerenciadores de tempo",
  load_balance: "Balanceamento inicial e alocação",
  rebalance_evaluation: "Avaliação de rebalanceamento",
  rebalance: "Rebalanceamento de shards",
  route_vehicle: "Cálculo de rotas de veículos",
  route_walking: "Cálculo de rotas a pé",
}
