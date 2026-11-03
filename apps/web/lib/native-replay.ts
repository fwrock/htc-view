/** Server-side HTTP bridge: replay one completed SimEDaPE run using its own inputs. */
import { createHash } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

interface ReplayFile {
  name: string
  sha256: string
  url: string
}

export interface NativeReplayDescriptor {
  schema: "simedape.native_replay.v1"
  run_id: string
  scenario_id: string
  receipt_sha256: string
  files: ReplayFile[]
  report: ReplayFile
}

interface NativeReplayManifest {
  scenarioId: string
  vehicleCount: number
  boundingBox?: {
    minLat: number
    maxLat: number
    minLon: number
    maxLon: number
  }
  source?: {
    runId: string
    receiptSha256: string
    committedSha256: string
    roadNetworkSha256?: string
  }
}

function validMapBounds(manifest: NativeReplayManifest): boolean {
  const b = manifest.boundingBox
  return (
    !!b &&
    [b.minLat, b.maxLat, b.minLon, b.maxLon].every(Number.isFinite) &&
    Math.abs(b.minLat) <= 85.05112878 &&
    Math.abs(b.maxLat) <= 85.05112878 &&
    Math.abs(b.minLon) <= 180 &&
    Math.abs(b.maxLon) <= 180 &&
    b.minLat <= b.maxLat &&
    b.minLon <= b.maxLon
  )
}

export function nativeReplayManifestMatches(
  manifest: NativeReplayManifest,
  descriptor: NativeReplayDescriptor
): boolean {
  return (
    manifest.scenarioId === descriptor.scenario_id &&
    validMapBounds(manifest) &&
    manifest.source?.runId === descriptor.run_id &&
    manifest.source?.receiptSha256 === descriptor.receipt_sha256 &&
    manifest.source?.committedSha256 === descriptor.report.sha256 &&
    manifest.source?.roadNetworkSha256 ===
      descriptor.files.find((file) => file.name === "road_network.json")?.sha256
  )
}

export function nativeReplayRunId(scenario: string): string | null {
  if (!validReplayName(scenario)) throw new Error("Invalid replay name")
  const match = /^simedape-([a-f0-9]{32})$/.exec(scenario)
  return match?.[1] ?? null
}

export function validReplayName(name: string): boolean {
  return (
    !!name &&
    name !== "." &&
    !/[\\/]/.test(name) &&
    ![...name].some((character) => character.charCodeAt(0) < 32) &&
    !name.includes("..")
  )
}

export function simedapeServerUrl(): string {
  return (
    process.env.SIMEDAPE_API_URL ??
    process.env.NEXT_PUBLIC_SIMEDAPE_API_URL ??
    "http://127.0.0.1:5000"
  ).replace(/\/$/, "")
}

async function apiResponse(base: string, url: string): Promise<Response> {
  const response = await fetch(base + url, {
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `SimEDaPE HTTP ${response.status}`)
  }
  return response
}

export async function nativeReplayDescriptor(
  scenario: string,
  base = simedapeServerUrl()
): Promise<NativeReplayDescriptor> {
  const runId = nativeReplayRunId(scenario)
  if (!runId) throw new Error("Expected a native replay scenario")
  const prefix = `/api/runs/${runId}/native`
  const descriptor = (await (
    await apiResponse(base, `${prefix}/replay`)
  ).json()) as NativeReplayDescriptor
  const sha = /^[a-f0-9]{64}$/
  if (
    descriptor.schema !== "simedape.native_replay.v1" ||
    descriptor.run_id !== runId ||
    descriptor.scenario_id !== scenario ||
    !sha.test(descriptor.receipt_sha256)
  ) {
    throw new Error("SimEDaPE replay identity does not match the selected run")
  }
  if (!Array.isArray(descriptor.files) || !descriptor.files.length)
    throw new Error("Native replay has no geometry inputs")
  const names = new Set<string>()
  for (const file of descriptor.files) {
    if (
      !/^(simulation\.json|road_network\.json|(nodes|links|traffic_signals)_\d+\.json)$/.test(
        file.name
      ) ||
      names.has(file.name) ||
      !sha.test(file.sha256) ||
      file.url !== `${prefix}/replay/files/${file.name}`
    ) {
      throw new Error("Invalid native replay input descriptor")
    }
    names.add(file.name)
  }
  if (
    !names.has("simulation.json") ||
    ![...names].some((n) => n.startsWith("nodes_")) ||
    ![...names].some((n) => n.startsWith("links_"))
  ) {
    throw new Error("Native replay is missing its clock or geometry")
  }
  if (
    descriptor.report?.name !== "committed.parquet" ||
    !sha.test(descriptor.report.sha256) ||
    descriptor.report.url !== `${prefix}/artifacts/committed.parquet`
  ) {
    throw new Error("Invalid committed native replay report")
  }
  return descriptor
}

async function download(base: string, file: ReplayFile, destination: string) {
  const data = Buffer.from(
    await (await apiResponse(base, file.url)).arrayBuffer()
  )
  if (createHash("sha256").update(data).digest("hex") !== file.sha256) {
    throw new Error(`Native replay input hash mismatch: ${file.name}`)
  }
  await writeFile(destination + ".tmp", data)
  await rename(destination + ".tmp", destination)
}

export async function prepareNativeReplay(
  scenario: string,
  replayOutDir: string,
  base = simedapeServerUrl()
) {
  const descriptor = await nativeReplayDescriptor(scenario, base)
  const inputDir = path.join(replayOutDir, ".native-inputs", descriptor.run_id)
  const dataDir = path.join(inputDir, "data")
  const parquetDir = path.join(inputDir, "reports")
  await mkdir(dataDir, { recursive: true })
  await mkdir(parquetDir, { recursive: true })
  for (const file of descriptor.files) {
    await download(
      base,
      file,
      path.join(file.name === "simulation.json" ? inputDir : dataDir, file.name)
    )
  }
  await download(
    base,
    descriptor.report,
    path.join(parquetDir, descriptor.report.name)
  )
  await writeFile(
    path.join(inputDir, "source.json"),
    JSON.stringify(descriptor, null, 2) + "\n"
  )
  return { descriptor, dataDir, parquetDir }
}

export async function bindNativeReplayManifest(
  outDir: string,
  descriptor: NativeReplayDescriptor
) {
  const filename = path.join(outDir, "manifest.json")
  const manifest = JSON.parse(await readFile(filename, "utf8"))
  if (
    manifest.scenarioId !== descriptor.scenario_id ||
    !(manifest.vehicleCount > 0)
  ) {
    throw new Error(
      "Replay ETL produced no vehicles or a different run identity"
    )
  }
  if (!validMapBounds(manifest))
    throw new Error(
      "Replay map coordinates must be geographic longitude/latitude within Web Mercator bounds"
    )
  manifest.source = {
    type: "simedape_native",
    runId: descriptor.run_id,
    receiptSha256: descriptor.receipt_sha256,
    committedSha256: descriptor.report.sha256,
  }
  const roadFile = descriptor.files.find(
    (file) => file.name === "road_network.json"
  )
  if (roadFile) {
    const input = path.join(
      outDir,
      "..",
      ".native-inputs",
      descriptor.run_id,
      "data",
      roadFile.name
    )
    const bytes = await readFile(input)
    if (createHash("sha256").update(bytes).digest("hex") !== roadFile.sha256)
      throw new Error("OSM road geometry changed during replay generation")
    const network = JSON.parse(bytes.toString())
    const box = {
      minLat: Infinity,
      maxLat: -Infinity,
      minLon: Infinity,
      maxLon: -Infinity,
    }
    for (const road of Object.values(network.links) as {
      coordinates: [number, number][]
    }[]) {
      for (const [lon, lat] of road.coordinates) {
        box.minLat = Math.min(box.minLat, lat)
        box.maxLat = Math.max(box.maxLat, lat)
        box.minLon = Math.min(box.minLon, lon)
        box.maxLon = Math.max(box.maxLon, lon)
      }
    }
    if (!validMapBounds({ ...manifest, boundingBox: box }))
      throw new Error("Invalid OSM road-shape bounds")
    // Interior shape vertices may be far from the simulated junction endpoints.
    manifest.boundingBox = box
    await writeFile(path.join(outDir, roadFile.name), bytes)
    manifest.mapMode = "osm"
    manifest.files.roadNetwork = roadFile.name
    manifest.source.roadNetworkSha256 = roadFile.sha256
  } else manifest.mapMode = "standalone"
  await writeFile(filename + ".tmp", JSON.stringify(manifest, null, 2) + "\n")
  await rename(filename + ".tmp", filename)
}

export function replayRunCommand(
  scenario: string,
  parquetDir: string,
  dataDir: string,
  outDir: string
): string {
  // sbt parses this string itself; quote each value so paths with spaces remain one argument.
  return `run --scenario ${JSON.stringify(scenario)} --input-parquet-dir ${JSON.stringify(parquetDir)} --scenario-json-dir ${JSON.stringify(dataDir)} --out ${JSON.stringify(outDir)}`
}
