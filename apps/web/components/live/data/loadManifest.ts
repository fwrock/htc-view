import type { Manifest } from "../types/replay";
import type { ScenarioSource } from "./scenarioSource";

export async function loadManifest(source: ScenarioSource): Promise<Manifest> {
  const text = await source.fetchText("manifest.json");
  if (text === null) throw new Error(`failed to load manifest.json from '${source.label}'`);
  return JSON.parse(text) as Manifest;
}
