export interface WarpingSettings {
  algorithm: "exact" | "fastdtw"
  radius: number
  n_jobs: number
  batch_size: number
}

export function warpingSettings(form: {
  dtwAlgorithm: "exact" | "fastdtw"
  dtwRadius: string
  dtwWorkers: string
  dtwBatchSize: string
}): WarpingSettings {
  const integer = (text: string, min: number, max: number, label: string) => {
    const value = Number(text)
    if (!text.trim() || !Number.isInteger(value) || value < min || value > max) {
      throw new Error(`${label}: ${min}–${max}`)
    }
    return value
  }
  if (!["exact", "fastdtw"].includes(form.dtwAlgorithm)) throw new Error("DTW algorithm: exact / fastdtw")
  return {
    algorithm: form.dtwAlgorithm,
    radius: integer(form.dtwRadius, 0, 128, "FastDTW radius"),
    n_jobs: integer(form.dtwWorkers, 0, 256, "DTW workers"),
    batch_size: integer(form.dtwBatchSize, 1, 4096, "DTW batch size"),
  }
}
