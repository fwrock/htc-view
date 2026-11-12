interface Metric { name: string; value: number; labels?: Record<string,string> }

export function coverageWarnings(samples: Metric[]): string[] {
  const expected = samples.find(s=>s.name==="htc_cluster_metrics_expected_nodes")?.value
  const available = samples.find(s=>s.name==="htc_cluster_metrics_available_nodes")?.value
  if (expected === undefined || available === undefined || available >= expected) return []
  const missing = samples.filter(s=>s.name==="htc_cluster_metrics_scrape_success" && s.value===0).map(s=>s.labels?.target).filter(Boolean)
  return [`Incomplete cluster metrics: ${available}/${expected} exporters available${missing.length ? `; unavailable: ${missing.join(", ")}` : ""}. Totals include only responding exporters.`]
}

export function observeProcessIdentities(previous: Map<string,number>, samples: Metric[]) {
  const identities = new Map(previous)
  let restarted = false
  for (const s of samples.filter(s=>s.name==="process_start_time_seconds")) {
    const node=s.labels?.node??""
    if (previous.has(node) && previous.get(node)!==s.value) restarted=true
    identities.set(node,s.value)
  }
  return {identities,restarted}
}
