export interface DerivedRunConfig {
  simulation_id: string
  partial: { selectionFile: string; filterableClasses: string[]; reportFile?: string } | null
  modifications: { files: string[] } | null
}

/** Explicit editor changes must survive starting a scenario selected by path. */
export function simulationStartPlan({ configFile, manualPath, appliedConfig, derived }: {
  configFile: string
  manualPath: boolean
  appliedConfig?: Record<string, unknown> | null
  derived?: DerivedRunConfig
}) {
  if (appliedConfig && !manualPath) {
    const config = { ...appliedConfig }
    if (derived) {
      config.id = derived.simulation_id
      if (derived.partial) config.partial = derived.partial
      if (derived.modifications) config.modifications = derived.modifications
    }
    return { config, body: undefined }
  }
  return { config: undefined, body: configFile ? { configFile } : undefined }
}
