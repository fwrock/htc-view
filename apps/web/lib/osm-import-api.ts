import type { FeatureCollection, LineString } from "geojson"

const BASE = process.env.NEXT_PUBLIC_SIMEDAPE_API_URL ?? "http://localhost:5000"

export class OsmImportApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export type ImportOptions = {
  bbox: [number, number, number, number] | null
  max_ways: number
  cars: number
  duration: number
  allow_disconnected: boolean
}
export type RoadProperties = {
  osm_way_id: string
  name: string
  direction: string
  length_m: number
  speed_limit_kmh: number
  source_tags: Record<string, string>
}
export type ImportReport = {
  status: "ready" | "invalid" | "published"
  preview_sha256?: string
  scenario_ref?: string
  published?: { directory: string; simulation: string } | null
  diagnostics: {
    level: "error" | "warning"
    code: string
    entity: string
    message: string
  }[]
  selection?: {
    ways: string[]
    nodes: number
    extent: { west: number; south: number; east: number; north: number }
  }
  network?: {
    directed_links: number
    simulation_nodes: number
    weak_components: number
  }
  geometry_preview?: FeatureCollection<LineString, RoadProperties>
}
export type ImportJob = {
  run_id: string
  status: "queued" | "running" | "completed" | "failed" | "cancelled"
  error: string | null
  logs: string
  meta: {
    workflow?: string
    source_location?: string
    source?: string
    options?: ImportOptions
    target_location?: string
    revision?: string
  }
  result?: { osm_import?: ImportReport }
}
export type SourceListing = {
  directory: string
  parent: string | null
  truncated: boolean
  entries: {
    name: string
    path: string
    directory: boolean
    bytes: number | null
  }[]
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const data = await response.json()
  if (!response.ok)
    throw new OsmImportApiError(
      data.error ?? `HTTP ${response.status}`,
      response.status
    )
  return data as T
}

export const browseOsmSources = (location: string, directory = "") =>
  request<SourceListing>(
    `/api/htc/osm/sources?${new URLSearchParams({ location, directory })}`
  )
export const previewOsm = (
  source_location: string,
  source: string,
  options: ImportOptions
) =>
  request<{ run_id: string }>("/api/htc/osm/preview", {
    source_location,
    source,
    options,
  })
export const publishOsm = (
  preview_run_id: string,
  target_location: string,
  revision: string
) =>
  request<{ run_id: string }>("/api/htc/osm/publish", {
    preview_run_id,
    target_location,
    revision,
  })
export const getOsmJob = (id: string) =>
  request<ImportJob>(`/api/runs/${encodeURIComponent(id)}`)
