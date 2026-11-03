/** Where a scenario's ETL output files (`manifest.json`, `links.arrow`, `segments.arrow`, ...)
 * come from. `HttpScenarioSource` fetches `/data/<scenarioId>/<file>` — a scenario the ETL
 * already wrote into `apps/web/public/data/`.
 *
 * The original htc-replay standalone app also had a `LocalFolderScenarioSource` (a
 * `<input webkitdirectory>` folder picker reading files directly off the user's disk). That's
 * intentionally dropped in this port — htc-ui already has a real scenario browser hitting the
 * engine API for a different purpose, and a local folder picker is out of scope for the
 * live-viz migration.
 *
 * Every loader in `loadManifest.ts`/`loadFrames.ts` goes through this interface instead of
 * calling `fetch()` directly.
 */
export interface ScenarioSource {
  /** Human-readable label for status/error messages — the scenario id. */
  label: string;
  /** Reads a JSON/text file (`manifest.json`, `signals.json`, `stops.json`). Returns `null` if
   * the file doesn't exist — several of these are optional per-scenario (see `loadSignals`/
   * `loadStops`), and "missing" must be distinguishable from "network/read error". */
  fetchText(fileName: string): Promise<string | null>;
  /** Reads a binary file (`*.arrow`). Throws if missing — every caller of this treats an Arrow
   * file as required (unlike the optional JSON ones). */
  fetchBinary(fileName: string): Promise<ArrayBuffer>;
}

export class HttpScenarioSource implements ScenarioSource {
  constructor(public readonly scenarioId: string) {}

  get label(): string {
    return this.scenarioId;
  }

  private url(fileName: string): string {
    return `/data/${this.scenarioId}/${fileName}`;
  }

  async fetchText(fileName: string): Promise<string | null> {
    const res = await fetch(this.url(fileName));
    if (!res.ok) return null;
    return res.text();
  }

  async fetchBinary(fileName: string): Promise<ArrayBuffer> {
    const res = await fetch(this.url(fileName));
    if (!res.ok) throw new Error(`failed to fetch '${this.url(fileName)}': HTTP ${res.status}`);
    return res.arrayBuffer();
  }
}
