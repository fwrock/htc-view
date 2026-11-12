import { type NextRequest, NextResponse } from "next/server"
import { closeSync, existsSync, fstatSync, openSync, readdirSync, readSync, statSync } from "node:fs"

// ---------------------------------------------------------------------------
// Live demo logs bridge. The run-live-demo.sh script redirects each stack
// component's stdout/stderr to a fixed file under /tmp, so this server-side
// route tails those files and exposes the tail as JSON for the /simulator
// "Logs" panel. Paths are overridable via env for non-default setups.
// ---------------------------------------------------------------------------

export const runtime = "nodejs"
export const revalidate = 0

export interface LogFileDescriptor {
  id: string
  label: string
  path: string
  /** Whether the file exists now, and when it was last written (ms since epoch). */
  exists?: boolean
  updatedAt?: number
}

// Where the current native demo (scripts/run-native-integration-demo.sh) keeps its files.
const DEMO_DIR =
  process.env.HTC_NATIVE_DEMO_DIR ??
  `/tmp/htc-native-demo-${typeof process.getuid === "function" ? process.getuid() : 0}`

/** engine.log of the most recent HTC run under <demo>/output/<run-id>/ (the engine of a native run is short-lived and writes there). */
function latestEngineLog(): { path: string; runId: string } | null {
  const root = process.env.HTC_NATIVE_OUTPUT_DIR ?? `${DEMO_DIR}/output`
  try {
    let best: { path: string; runId: string; mtime: number } | null = null
    for (const name of readdirSync(root)) {
      const path = `${root}/${name}/engine.log`
      if (!existsSync(path)) continue
      const mtime = statSync(path).mtimeMs
      if (!best || mtime > best.mtime) best = { path, runId: name, mtime }
    }
    return best
  } catch {
    return null
  }
}

function logFiles(): LogFileDescriptor[] {
  const latest = latestEngineLog()
  const list: LogFileDescriptor[] = [
    // Current native demo
    {
      id: "native-engine",
      label: latest ? `engine: última execução (${latest.runId.slice(0, 8)})` : "engine: última execução",
      path: latest?.path ?? `${DEMO_DIR}/output/<execução>/engine.log`,
    },
    { id: "native-api", label: "API de jobs (SimEDaPE)", path: process.env.HTC_API_LOG ?? `${DEMO_DIR}/api.log` },
    { id: "native-view", label: "HTC View (servidor web)", path: process.env.HTC_VIEW_LOG ?? `${DEMO_DIR}/view.log` },
    // Live demo (scripts/run-live-demo.sh): a long-running engine, bus-live and dev server
    { id: "engine", label: "engine em serviço (demo ao vivo)", path: process.env.HTC_ENGINE_LOG ?? "/tmp/htc-engine.log" },
    { id: "bus-live", label: "htc-bus-live (demo ao vivo)", path: process.env.HTC_BUS_LIVE_LOG ?? "/tmp/htc-bus-live.log" },
    { id: "ui", label: "htc-ui dev server (demo ao vivo)", path: process.env.HTC_UI_LOG ?? "/tmp/htc-ui-dev.log" },
  ]
  const directory = process.env.HTC_LOGS_DIR
  if (directory) {
    list.unshift(
      { id: "stack-engine", label: "HTC engine", path: `${directory}/engine.log` },
      { id: "stack-bus-live", label: "HTC Bus Live", path: `${directory}/bus-live.log` },
      { id: "stack-simedape", label: "SimEDaPE Python API", path: `${directory}/simedape.log` },
      { id: "stack-simedape-scala", label: "SimEDaPE Scala API", path: `${directory}/simedape-scala.log` },
      { id: "stack-view", label: "HTC View", path: `${directory}/view.log` },
    )
  }
  return list.map((f) => {
    try {
      const st = statSync(f.path)
      return { ...f, exists: st.isFile(), updatedAt: st.mtimeMs }
    } catch {
      return { ...f, exists: false }
    }
  })
}

// Read at most the last 1MB of a file (a bounded tail window), then take the
// last N lines from it. Avoids slurping a runaway multi-GB log into memory.
const MAX_BYTES = 1024 * 1024

function tailText(path: string, maxLines: number): string {
  if (!existsSync(path)) return ""
  let fd: number | undefined
  try {
    fd = openSync(path, "r")
    const size = fstatSync(fd).size
    if (size === 0) return ""

    const window = Math.min(size, MAX_BYTES)
    const buffer = Buffer.alloc(window)
    readSync(fd, buffer, 0, window, size - window)

    const lines = buffer.toString("utf8").split("\n")
    // If we didn't read from byte 0, the first captured line is partial — drop it.
    const start = size - window > 0 ? 1 : 0
    return lines.slice(start).slice(-maxLines).join("\n")
  } catch (error) {
    return `Unable to read log: ${(error as Error).message}`
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const requestedFile = searchParams.get("file")
  const rawLines = searchParams.get("lines")
  const lines = Math.max(
    1,
    Math.min(parseInt(rawLines ?? "500", 10) || 500, 2000)
  )

  const files = logFiles()

  if (requestedFile) {
    const target = files.find((f) => f.id === requestedFile)
    if (!target) {
      return NextResponse.json(
        { error: `Unknown log file: ${requestedFile}` },
        { status: 404 }
      )
    }
    return NextResponse.json({
      files,
      file: target.id,
      lines,
      logs: { [target.id]: tailText(target.path, lines) },
    })
  }

  const logs: Record<string, string> = {}
  for (const f of files) logs[f.id] = tailText(f.path, lines)
  return NextResponse.json({ files, lines, logs })
}
