import { NextResponse } from "next/server"
import { spawn } from "node:child_process"
import { mkdir, readFile, stat, unlink } from "node:fs/promises"
import path from "node:path"
import {
  getReplayConfig,
  scenarioDataDir,
  scenarioOutDir,
  scenarioParquetDir,
  liveGeometryOutDir,
} from "@/lib/replay-config"
import {
  bindNativeReplayManifest,
  nativeReplayDescriptor,
  nativeReplayRunId,
  nativeReplayManifestMatches,
  prepareNativeReplay,
  replayRunCommand,
  validReplayName,
  type NativeReplayDescriptor,
} from "@/lib/native-replay"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface Generation {
  status: "generating" | "done" | "error"
  startedAt: number
  outDir: string
  message: string
}

/** Single-process ETL status shared across development hot reloads. A server restart clears
 *  this map; published manifests remain on disk. Multi-worker deployments need a job service. */
const processState = globalThis as typeof globalThis & {
  htcReplayGenerations?: Map<string, Generation>
}
const generations = (processState.htcReplayGenerations ??= new Map<
  string,
  Generation
>())

function validateName(name: string): string | null {
  if (!validReplayName(name)) {
    return "invalid scenario name"
  }
  try {
    nativeReplayRunId(name)
  } catch {
    return "invalid native replay run id"
  }
  return null
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory()
  } catch {
    return false
  }
}

/** Reports whether replay artifacts exist for a scenario, or the generation status if one is
 *  currently running. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ scenario: string }> }
) {
  const { scenario } = await params
  const bad = validateName(scenario)
  if (bad) return NextResponse.json({ error: bad }, { status: 400 })

  const cfg = getReplayConfig()
  const live = new URL(req.url).searchParams.get("mode") === "live"
  const outDir = live ? liveGeometryOutDir(cfg, scenario) : scenarioOutDir(cfg, scenario)
  const nativeRun = nativeReplayRunId(scenario)
  const running = generations.get(live ? `live:${scenario}` : scenario)

  if (running?.status === "generating") {
    return NextResponse.json({
      status: "generating",
      scenario,
      outDir,
      startedAt: running.startedAt,
    })
  }
  if (running?.status === "error") {
    return NextResponse.json(
      { status: "error", scenario, outDir, message: running.message },
      { status: 500 }
    )
  }

  let descriptor: NativeReplayDescriptor | undefined
  if (nativeRun) {
    try {
      descriptor = await nativeReplayDescriptor(scenario)
    } catch (e) {
      return NextResponse.json(
        { status: "error", scenario, message: (e as Error).message },
        { status: 503 }
      )
    }
  }
  try {
    const manifest = JSON.parse(
      await readFile(path.join(outDir, "manifest.json"), "utf8")
    )
    if (descriptor && !nativeReplayManifestMatches(manifest, descriptor)) {
      throw new Error("Replay is not bound to the selected native run")
    }
    return NextResponse.json({ status: "ready", scenario, outDir, manifest })
  } catch {
    return NextResponse.json({
      status: "not_generated",
      scenario,
      outDir,
      parquetDir: nativeRun
        ? path.join(cfg.outDir, ".native-inputs", nativeRun, "reports")
        : live ? path.join(outDir, ".empty-events") : scenarioParquetDir(cfg, scenario),
      dataDir: nativeRun
        ? path.join(cfg.outDir, ".native-inputs", nativeRun, "data")
        : scenarioDataDir(cfg, scenario),
      hint: "POST /api/replay/<scenario> to generate replay artifacts from the Parquet outputs",
    })
  }
}

/** Triggers an on-demand run of the htc-replay ETL (`sbt run`) to derive `segments.arrow` +
 *  geometry artifacts from a scenario's Parquet outputs. Runs asynchronously; poll
 *  `GET /api/replay/<scenario>` until `status` is `ready` or `error`. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ scenario: string }> }
) {
  const { scenario } = await params
  const bad = validateName(scenario)
  if (bad) return NextResponse.json({ error: bad }, { status: 400 })

  const cfg = getReplayConfig()
  let dataDir = scenarioDataDir(cfg, scenario)
  const live = new URL(req.url).searchParams.get("mode") === "live"
  const outDir = live ? liveGeometryOutDir(cfg, scenario) : scenarioOutDir(cfg, scenario)
  // A live map needs static geometry only. Never read active Parquet files, whose footers
  // may not have been flushed yet, or overwrite artifacts belonging to a finished replay.
  let parquetDir = live ? path.join(outDir, ".empty-events") : scenarioParquetDir(cfg, scenario)
  const nativeRun = nativeReplayRunId(scenario)

  if (!nativeRun && !(await isDir(dataDir))) {
    return NextResponse.json(
      { error: "scenario data dir not found", dataDir },
      { status: 404 }
    )
  }

  const generationKey = live ? `live:${scenario}` : scenario
  const running = generations.get(generationKey)
  if (running?.status === "generating") {
    return NextResponse.json(
      { status: "generating", scenario, outDir, startedAt: running.startedAt },
      { status: 202 }
    )
  }

  const gen: Generation = {
    status: "generating",
    startedAt: Date.now(),
    outDir,
    message: "",
  }
  generations.set(generationKey, gen)

  let descriptor: NativeReplayDescriptor | undefined
  try {
    if (nativeRun) {
      const prepared = await prepareNativeReplay(scenario, cfg.outDir)
      dataDir = prepared.dataDir
      parquetDir = prepared.parquetDir
      descriptor = prepared.descriptor
    }
    // Legacy scenarios may intentionally generate geometry-only replay.
    await mkdir(parquetDir, { recursive: true })
    await mkdir(outDir, { recursive: true })
    if (nativeRun) {
      // Stop serving the previous generation while ETL rewrites its Arrow files.
      await unlink(path.join(outDir, "manifest.json")).catch((error) => {
        if (error.code !== "ENOENT") throw error
      })
    }
  } catch (e) {
    gen.status = "error"
    gen.message = (e as Error).message
    return NextResponse.json(
      { status: "error", scenario, message: gen.message, error: gen.message },
      { status: 503 }
    )
  }
  const runCmd = replayRunCommand(scenario, parquetDir, dataDir, outDir)

  const child = spawn("sbt", [...(live ? ["-J-Xmx512m"] : []), "-batch", runCmd], {
    cwd: cfg.etlDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: live ? {
      ...process.env,
      JAVA_TOOL_OPTIONS: [process.env.JAVA_TOOL_OPTIONS, process.env.HTC_LIVE_GEOMETRY_JAVA_OPTS ?? "-Xmx2g"].filter(Boolean).join(" "),
    } : process.env,
  })
  let tail = ""
  const capture = (chunk: Buffer) => {
    tail = (tail + chunk.toString()).slice(-4000)
  }
  child.stdout.on("data", capture)
  child.stderr.on("data", capture)

  child.on("error", (err) => {
    gen.status = "error"
    gen.message = err.message
  })
  child.on("close", async (code) => {
    try {
      if (code !== 0)
        throw new Error(tail || `Replay ETL exited with code ${code}`)
      if (descriptor) await bindNativeReplayManifest(outDir, descriptor)
      gen.status = "done"
      gen.message = tail
    } catch (e) {
      gen.status = "error"
      gen.message = (e as Error).message
    }
  })

  return NextResponse.json(
    {
      status: "generating",
      scenario,
      outDir,
      parquetDir,
      dataDir,
      etlDir: cfg.etlDir,
    },
    { status: 202 }
  )
}
