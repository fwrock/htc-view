import { NextResponse } from "next/server"
import { readdir, stat } from "node:fs/promises"
import path from "node:path"
import {
  getReplayConfig,
  scenarioDataDir,
  scenarioOutDir,
  scenarioParquetDir,
} from "@/lib/replay-config"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory()
  } catch {
    return false
  }
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile()
  } catch {
    return false
  }
}

async function parquetFileCount(dir: string): Promise<number> {
  try {
    const entries = await readdir(dir)
    return entries.filter((f) => f.endsWith(".parquet")).length
  } catch {
    return 0
  }
}

/** Lists every scenario the bridge can see, together with what it can locate for each one —
 *  geometry (`data/`), Parquet outputs, and already-generated replay artifacts. This is the
 *  direct answer to "does the bridge find the files for a given scenario?" */
export async function GET() {
  const cfg = getReplayConfig()

  let names: string[] = []
  try {
    const entries = await readdir(cfg.scenariosDir)
    const withData: string[] = []
    for (const entry of entries) {
      if (await isDir(path.join(cfg.scenariosDir, entry, "data"))) {
        withData.push(entry)
      }
    }
    names = withData.sort()
  } catch {
    // scenarios dir missing/unreadable — still return the resolved paths so the caller can see
    // exactly where the bridge is looking.
  }

  const scenarios = []
  for (const name of names) {
    const parquetFiles = await parquetFileCount(scenarioParquetDir(cfg, name))
    scenarios.push({
      name,
      hasGeometry: await isDir(scenarioDataDir(cfg, name)),
      parquetFiles,
      hasArtifacts: await isFile(path.join(scenarioOutDir(cfg, name), "manifest.json")),
    })
  }

  return NextResponse.json({
    scenariosDir: cfg.scenariosDir,
    parquetDir: cfg.parquetDir,
    outDir: cfg.outDir,
    etlDir: cfg.etlDir,
    count: scenarios.length,
    scenarios,
  })
}
