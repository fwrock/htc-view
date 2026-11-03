import type { ScenarioSource } from "./scenarioSource"

/** Reads scenario artifacts through the `/api/replay` bridge, which serves the htc-replay ETL
 *  output for a scenario (falling back to the bundled copy under `public/data/`). Unlike
 *  `HttpScenarioSource` (static `/data/<id>/`), this lets the viewer load geometry for *any*
 *  scenario the bridge can resolve from the engine's configured directories — not just the ones
 *  manually copied into `public/data/`. */
export class ApiReplayScenarioSource implements ScenarioSource {
  constructor(public readonly scenarioId: string, private readonly liveGeometry = false) {}

  get label(): string {
    return this.scenarioId
  }

  private url(fileName: string): string {
    return `/api/replay/${encodeURIComponent(this.scenarioId)}/${fileName}${this.liveGeometry ? "?mode=live" : ""}`
  }

  async fetchText(fileName: string): Promise<string | null> {
    const res = await fetch(this.url(fileName))
    if (!res.ok) return null
    return res.text()
  }

  async fetchBinary(fileName: string): Promise<ArrayBuffer> {
    const res = await fetch(this.url(fileName))
    if (!res.ok) throw new Error(`failed to fetch '${this.url(fileName)}': HTTP ${res.status}`)
    return res.arrayBuffer()
  }
}
