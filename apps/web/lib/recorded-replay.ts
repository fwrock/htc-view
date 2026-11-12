import { readdir, stat } from "node:fs/promises"
import path from "node:path"

interface RecordedRun { id: string; scenario_key?: string; run_kind?: string; label?: string }
interface Paths { scenariosDir: string; parquetDir: string }

async function hasParquet(directory: string) {
  try { return (await readdir(directory)).some((name) => name.endsWith(".parquet")) }
  catch { return false }
}

/** Read one recorded run, never create directories in the read-only report mounts. */
export async function resolveRecordedReplay(cfg: Paths, scenario: string, runs: RecordedRun[]) {
  const legacy = path.join(cfg.parquetDir, scenario)
  if (await hasParquet(legacy)) return { parquetDir: legacy, reportId: scenario, label: scenario }
  const candidates: { parquetDir: string; reportId: string; label: string; modified: number }[] = []
  for (const run of runs) {
    if (run.scenario_key !== scenario || run.run_kind !== "base" || !/^[A-Za-z0-9_-]+$/.test(run.id)) continue
    for (const directory of [path.join(cfg.parquetDir, run.id), path.join(cfg.scenariosDir, scenario, "reports", "parquet", run.id)]) {
      if (await hasParquet(directory)) candidates.push({ parquetDir:directory, reportId:run.id, label:run.label ?? `${scenario} · ${run.id}`, modified:(await stat(directory)).mtimeMs })
    }
  }
  candidates.sort((a,b) => b.modified-a.modified || a.reportId.localeCompare(b.reportId))
  if (!candidates.length) throw new Error(`No completed base Parquet reports found for ${scenario}. Run the full scenario with Parquet reporting enabled.`)
  return candidates[0]!
}

export async function recordedRuns(): Promise<RecordedRun[]> {
  const base=process.env.SIMEDAPE_API_URL ?? "http://localhost:5000"
  const response=await fetch(`${base}/api/simulations`, {cache:"no-store",signal:AbortSignal.timeout(15000)})
  if (!response.ok) throw new Error("Cannot resolve scenario report UUIDs: SimEDaPE run catalogue is unavailable")
  return (await response.json()).simulations
}
