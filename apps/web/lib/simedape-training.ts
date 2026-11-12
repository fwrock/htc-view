import type { RunSummary } from "./simedape-api"

/** Recovery runs can omit clustering because their model already contains it. */
export function isTrainingRun(run: Pick<RunSummary, "meta">): boolean {
  return run.meta.training === true || !!run.meta.stages?.some(stage => ["clustering", "warping_paths", "pca_train"].includes(stage))
}

export function recoveryCandidates(runs: RunSummary[]): RunSummary[] {
  return runs.filter(run => isTrainingRun(run) && !!run.meta.output_dir && !["queued", "running"].includes(run.status))
}

export function hasTrainingModel(run: Pick<RunSummary, "meta">): boolean {
  return isTrainingRun(run) && !!run.meta.stages?.some(stage => ["clustering", "warping_paths", "pca_train", "model_export"].includes(stage))
}
