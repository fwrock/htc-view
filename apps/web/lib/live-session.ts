export interface RecordedIdentity { id: string; scenario_key?: string; scenario_id?: string; run_kind?: string }

export function latestRecordedBase(entries: RecordedIdentity[], scenario: string): string | null {
  const candidates=entries.filter((entry) => entry.scenario_key === scenario && entry.run_kind === "base")
  const order=(entry:RecordedIdentity) => entry.scenario_id?.match(/\d{14}$/)?.[0] ?? entry.id
  candidates.sort((a,b) => order(b).localeCompare(order(a)))
  return candidates[0]?.id ?? null
}

export function liveStreamUrl(base: string, reportId: string) {
  return `${base}${base.includes("?") ? "&" : "?"}simulationId=${encodeURIComponent(reportId)}`
}
