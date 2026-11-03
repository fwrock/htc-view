interface MetricSample { name: string; value: number }

export function timeWarpSummary(samples: MetricSample[]) {
  const sum = (name: string) => {
    const values = samples.filter((s) => s.name === name && Number.isFinite(s.value))
    return values.length ? values.reduce((total, s) => total + s.value, 0) : null
  }
  const flag = sum("htc_time_warp_enabled")
  const enabled = flag !== null ? flag > 0 : samples.some((s) => s.name === "htc_straggler_rollback_triggered_total" || s.name === "htc_antimessages_sent_total")
  return {
    enabled, gvt: sum("htc_time_warp_gvt"), workers: sum("htc_time_warp_workers"),
    commits: sum("htc_time_warp_commits_total"),
    rollbacks: sum("htc_straggler_rollback_triggered_total") ?? (enabled ? 0 : null),
    antiMessages: sum("htc_antimessages_sent_total") ?? (enabled ? 0 : null),
  }
}
