/**
 * Minimal Prometheus text format parser.
 * Handles gauge, counter, histogram, and summary types.
 */

export interface MetricSample {
  name: string
  labels: Record<string, string>
  value: number
}

export interface MetricFamily {
  name: string
  help: string
  type: "gauge" | "counter" | "histogram" | "summary" | "untyped"
  samples: MetricSample[]
}

export function parsePrometheusText(text: string): Map<string, MetricFamily> {
  const families = new Map<string, MetricFamily>()
  let currentHelp: { name: string; text: string } | null = null
  let currentType: { name: string; type: MetricFamily["type"] } | null = null

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim()
    if (line === "") continue

    if (line.startsWith("# HELP ")) {
      const rest = line.slice(7)
      const sp = rest.indexOf(" ")
      const name = sp === -1 ? rest : rest.slice(0, sp)
      const helpText = sp === -1 ? "" : rest.slice(sp + 1)
      currentHelp = { name, text: helpText }
      continue
    }

    if (line.startsWith("# TYPE ")) {
      const parts = line.slice(7).split(" ")
      const name = parts[0]
      if (!name) continue
      const type = (parts[1] ?? "untyped") as MetricFamily["type"]
      currentType = { name, type }
      if (!families.has(name)) {
        families.set(name, {
          name,
          help: currentHelp?.name === name ? (currentHelp?.text ?? "") : "",
          type,
          samples: [],
        })
      }
      continue
    }

    if (line.startsWith("#")) continue

    // Sample line: metric_name{labels} value [timestamp]
    const commentIdx = line.indexOf("#")
    const withoutComment = commentIdx === -1 ? line : line.slice(0, commentIdx).trim()

    let name: string
    let labels: Record<string, string> = {}
    let valueStr: string

    const braceOpen = withoutComment.indexOf("{")
    if (braceOpen !== -1) {
      const braceClose = withoutComment.indexOf("}")
      name = withoutComment.slice(0, braceOpen)
      const labelStr = withoutComment.slice(braceOpen + 1, braceClose)
      labels = parseLabels(labelStr)
      const rest = withoutComment.slice(braceClose + 1).trim()
      valueStr = rest.split(/\s+/)[0] ?? ""
    } else {
      const parts = withoutComment.split(/\s+/)
      name = parts[0] ?? ""
      valueStr = parts[1] ?? ""
    }

    if (!name || valueStr === undefined) continue

    const value = parseFloat(valueStr)
    if (isNaN(value)) continue

    // Find or create family — may be named without suffix (e.g. histogram base)
    const baseName = stripSuffix(name)
    const familyName = families.has(name)
      ? name
      : families.has(baseName)
        ? baseName
        : name

    if (!families.has(familyName)) {
      families.set(familyName, {
        name: familyName,
        help: "",
        type: "untyped",
        samples: [],
      })
    }

    families.get(familyName)!.samples.push({ name, labels, value })
  }

  return families
}

function parseLabels(labelStr: string): Record<string, string> {
  const result: Record<string, string> = {}
  const regex = /(\w+)="([^"\\]*(\\.[^"\\]*)*)"/g
  let m: RegExpExecArray | null
  while ((m = regex.exec(labelStr)) !== null) {
    const key = m[1]
    const val = m[2]
    if (key && val !== undefined) {
      result[key] = val.replace(/\\"/g, '"').replace(/\\\\/g, "\\")
    }
  }
  return result
}

function stripSuffix(name: string): string {
  for (const suffix of ["_total", "_sum", "_count", "_bucket", "_created"]) {
    if (name.endsWith(suffix)) return name.slice(0, -suffix.length)
  }
  return name
}

// ---------------------------------------------------------------------------
// Helpers to extract specific metric values
// ---------------------------------------------------------------------------

export function getGauge(
  families: Map<string, MetricFamily>,
  name: string
): number | null {
  const f = families.get(name)
  if (!f || f.samples.length === 0) return null
  return f.samples[0]?.value ?? null
}

export function getCounter(
  families: Map<string, MetricFamily>,
  name: string
): number | null {
  return getGauge(families, name)
}

/** Get labelled gauge/counter values as Record<labelValue, number> */
export function getLabelledValues(
  families: Map<string, MetricFamily>,
  name: string,
  labelKey: string
): Record<string, number> {
  const f = families.get(name)
  if (!f) return {}
  const result: Record<string, number> = {}
  for (const s of f.samples) {
    if (s.name === name && s.labels[labelKey] !== undefined) {
      result[s.labels[labelKey]] = s.value
    }
  }
  return result
}

/** Compute histogram average from _sum / _count samples */
export function getHistogramAvg(
  families: Map<string, MetricFamily>,
  baseName: string
): number | null {
  const f = families.get(baseName)
  if (!f) return null
  let sum: number | null = null
  let count: number | null = null
  for (const s of f.samples) {
    if (s.name === `${baseName}_sum`) sum = s.value
    if (s.name === `${baseName}_count`) count = s.value
  }
  if (sum === null || count === null || count === 0) return null
  return sum / count
}

/**
 * Get a single numeric value from a family where a specific label matches.
 * Useful for metrics like `jvm_memory_bytes_used{area="heap"}`.
 */
export function getSampleByLabel(
  families: Map<string, MetricFamily>,
  familyName: string,
  labelKey: string,
  labelValue: string
): number | null {
  const f = families.get(familyName)
  if (!f) return null
  for (const s of f.samples) {
    if (s.labels[labelKey] === labelValue) return s.value
  }
  return null
}

/**
 * Like getLabelledValues but filters by the exact sample name.
 * Needed for summary/histogram sub-metrics such as
 * `jvm_gc_collection_seconds_sum{gc="..."}` inside family
 * `jvm_gc_collection_seconds`.
 */
export function getLabelledValuesBySample(
  families: Map<string, MetricFamily>,
  familyName: string,
  sampleName: string,
  labelKey: string
): Record<string, number> {
  const f = families.get(familyName)
  if (!f) return {}
  const result: Record<string, number> = {}
  for (const s of f.samples) {
    if (s.name === sampleName && s.labels[labelKey] !== undefined) {
      result[s.labels[labelKey]] = s.value
    }
  }
  return result
}
