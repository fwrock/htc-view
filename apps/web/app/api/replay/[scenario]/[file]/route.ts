import { NextResponse } from "next/server"
import { readFile } from "node:fs/promises"
import path from "node:path"
import {
  getReplayConfig,
  REPLAY_ARTIFACT_FILES,
  scenarioOutDir,
  liveGeometryOutDir,
} from "@/lib/replay-config"
import {
  nativeReplayDescriptor,
  nativeReplayManifestMatches,
  nativeReplayRunId,
  validReplayName,
} from "@/lib/native-replay"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Fallback location for scenarios whose ETL output was already bundled into the app. */
const BUNDLED_DATA_DIR = path.join(process.cwd(), "public", "data")

async function readIfExists(p: string): Promise<Buffer | null> {
  try {
    return await readFile(p)
  } catch {
    return null
  }
}

function contentType(file: string): string {
  return file.endsWith(".json")
    ? "application/json"
    : "application/octet-stream"
}

/** Serves one replay artifact for a scenario — freshly generated ETL output first, then the
 *  bundled copy under `public/data/`. Only the known artifact filenames are ever read. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ scenario: string; file: string }> }
) {
  const { scenario, file } = await params
  if (!validReplayName(scenario))
    return NextResponse.json(
      { error: "invalid scenario name" },
      { status: 400 }
    )
  if (!REPLAY_ARTIFACT_FILES.includes(file)) {
    return NextResponse.json(
      { error: "unknown artifact", file },
      { status: 404 }
    )
  }

  const cfg = getReplayConfig()
  let nativeRun = false
  try {
    nativeRun = nativeReplayRunId(scenario) !== null
    if (nativeRun) {
      const descriptor = await nativeReplayDescriptor(scenario)
      const manifestBytes = await readIfExists(
        path.join(scenarioOutDir(cfg, scenario), "manifest.json")
      )
      if (
        !manifestBytes ||
        !nativeReplayManifestMatches(
          JSON.parse(manifestBytes.toString()),
          descriptor
        )
      ) {
        return NextResponse.json(
          { error: "native replay has not been generated for this run" },
          { status: 404 }
        )
      }
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 })
  }
  const live = new URL(req.url).searchParams.get("mode") === "live"
  const candidates = [path.join(live ? liveGeometryOutDir(cfg, scenario) : scenarioOutDir(cfg, scenario), file)]
  if (!nativeRun) candidates.push(path.join(BUNDLED_DATA_DIR, scenario, file))

  for (const p of candidates) {
    const buf = await readIfExists(p)
    if (buf) {
      const body = buf.buffer.slice(
        buf.byteOffset,
        buf.byteOffset + buf.byteLength
      ) as ArrayBuffer
      return new NextResponse(body, {
        headers: {
          "Content-Type": contentType(file),
          "Cache-Control": "no-store",
        },
      })
    }
  }

  return NextResponse.json(
    { error: "artifact not found", scenario, file },
    { status: 404 }
  )
}
