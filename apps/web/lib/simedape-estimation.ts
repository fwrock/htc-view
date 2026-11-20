import type { RunSummary } from "./simedape-api"

/** Server history survives a browser reset; never infer the partial from a run's display name. */
export function estimationInputs(run: Pick<RunSummary, "meta"> | null): {
  partial: string
  reference: string
  variants?: string[]
} | null {
  const params = run?.meta.stage_params
  const estimation = params?.estimation_variants ?? params?.estimation
  const partial = estimation?.second_scenario_dir
  if (typeof partial !== "string" || !partial.trim()) return null
  const reference = params?.scenario_metrics?.reference_dir
  const variants = params?.estimation_variants?.variants
  return {
    partial: partial.trim(),
    reference: typeof reference === "string" ? reference.trim() : "",
    ...(Array.isArray(variants) && variants.length > 0 && variants.every(v => typeof v === "string")
      ? { variants: [...variants] } : {}),
  }
}

/** Estimates and sweeps need physical road properties even when events come from ClickHouse. */
export function roadMetadataError(path: string): string | null {
  return path.trim() ? null : "Informe o arquivo de informações das vias antes de estimar."
}

/** Applying the same preset must not erase a manually repaired path. */
export function scenarioRoadFile(current: string, currentId: string, selectedId: string, recommended?: string): string {
  return recommended?.trim() || (currentId === selectedId ? current : "")
}
