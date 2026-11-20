import { existsSync } from "node:fs"
import path from "node:path"

/**
 * Server-side configuration for the replay bridge — the piece that lets the browser reach
 * scenario geometry and simulation outputs that live on the engine host's filesystem. The
 * browser cannot read those paths directly; the Next.js server can (in local/dev deployments
 * where it shares the host with the engine).
 *
 * The engine's `GET /api/v1/scenarios` exposes `scenariosDir` only as a *string* and serves no
 * files; the Parquet reports live in a separate output directory (`HTC_REPORT_PARQUET_DIRECTORY`).
 * This module pins those paths (env-overridable) and resolves per-scenario sub-paths so the
 * `/api/replay` route handlers have a single source of truth.
 */

/**
 * Repository root, so defaults work on any machine: `HTC_REPO_ROOT` if set, else the nearest
 * ancestor of the working directory that contains `hyperbolic-time-chamber/` (the htc-ui dev
 * server runs from htc-ui/apps/web). In a container there is no checkout: the compose file sets
 * every path below explicitly through environment variables.
 */
function repoRoot(): string {
  if (process.env.HTC_REPO_ROOT) return process.env.HTC_REPO_ROOT
  let dir = process.cwd()
  for (;;) {
    if (existsSync(path.join(dir, "hyperbolic-time-chamber", "build.sbt"))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return process.cwd()
    dir = parent
  }
}

/** The exact set of artifact filenames the htc-replay ETL writes (and the frontend reads).
 *  Used as an allow-list so the file-serving route can't be abused to read arbitrary paths. */
export const REPLAY_ARTIFACT_FILES: readonly string[] = [
  "manifest.json",
  "links.arrow",
  "nodes.arrow",
  "segments.arrow",
  "signals.json",
  "placements.json",
  "stops.json",
  "rail_links.arrow",
  "road_network.json",
]

export interface ReplayConfig {
  scenariosDir: string
  parquetDir: string
  outDir: string
  /** Directory of the htc-replay ETL (run via `sbt run` — the compiled jar is thin, with no
   *  bundled dependencies, so it can't be invoked with a bare `java -jar`). */
  etlDir: string
}

export function getReplayConfig(): ReplayConfig {
  const root = repoRoot()
  const engine = path.join(root, "hyperbolic-time-chamber")
  return {
    scenariosDir: process.env.HTC_SCENARIOS_DIR ?? path.join(engine, "simulations", "input"),
    parquetDir: process.env.HTC_REPORT_PARQUET_DIRECTORY ?? path.join(engine, "output", "reports", "parquet"),
    outDir: process.env.HTC_REPLAY_OUT_DIR ?? path.join(engine, "output", "replay"),
    etlDir: process.env.HTC_REPLAY_ETL_DIR ?? path.join(root, "htc-replay", "etl"),
  }
}

export function scenarioDir(cfg: ReplayConfig, name: string): string {
  return path.join(cfg.scenariosDir, name)
}

/** Geometry lives in `<scenarios-dir>/<name>/data/` (nodes_*.json, links_*.json, city_map.json…). */
export function scenarioDataDir(cfg: ReplayConfig, name: string): string {
  return path.join(scenarioDir(cfg, name), "data")
}

export function scenarioParquetDir(cfg: ReplayConfig, name: string): string {
  return path.join(cfg.parquetDir, name)
}

export function scenarioOutDir(cfg: ReplayConfig, name: string): string {
  return path.join(cfg.outDir, name)
}

/** Live geometry has no finished report input and must not replace a completed replay. */
export function liveGeometryOutDir(cfg: ReplayConfig, name: string): string {
  return path.join(cfg.outDir, ".live-geometry", name)
}
