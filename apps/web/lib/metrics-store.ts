"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { observeProcessIdentities } from "./metrics-coverage"

/** One scraped sample. `name` is the full sample name (histograms: *_bucket, *_sum, *_count). */
export interface Sample {
  name: string
  labels: Record<string, string>
  value: number
}
export interface FamilyMeta {
  name: string
  type: string
  help: string
}
export type Point = [ts: number, value: number]

const MAX_POINTS = 360
const MAX_SERIES = 6000

export interface MetricsStore {
  ts: number
  url: string
  meta: Map<string, FamilyMeta>
  latest: Sample[]
  warnings?: string[]
  /** series key -> time series, every poll appends one point to every series seen. */
  history: Map<string, { name: string; labels: Record<string, string>; points: Point[] }>
}

const keyOf = (name: string, labels: Record<string, string>) =>
  name + "|" + Object.keys(labels).sort().map((k) => `${k}=${labels[k]}`).join(",")

export function useMetricsStore(intervalMs: number, paused: boolean) {
  const [store, setStore] = useState<MetricsStore | null>(null)
  const [error, setError] = useState<{ message: string; url?: string } | null>(null)
  const history = useRef<MetricsStore["history"]>(new Map())
  const processIdentity = useRef(new Map<string,number>())

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/metrics/all", { cache: "no-store" })
      const body = await res.json()
      if (!res.ok) {
        setError({ message: body.error ?? `HTTP ${res.status}`, url: body.url })
        return
      }
      const ts: number = body.ts
      const latest: Sample[] = body.samples.map((s: { n: string; l: Record<string, string>; v: number }) => ({
        name: s.n,
        labels: s.l,
        value: s.v,
      }))
      const observed = observeProcessIdentities(processIdentity.current, latest)
      if (observed.restarted) history.current = new Map()
      processIdentity.current = observed.identities
      for (const s of latest) {
        const key = keyOf(s.name, s.labels)
        let series = history.current.get(key)
        if (!series) {
          if (history.current.size >= MAX_SERIES) continue
          series = { name: s.name, labels: s.labels, points: [] }
          history.current.set(key, series)
        }
        series.points.push([ts, s.value])
        if (series.points.length > MAX_POINTS) series.points.shift()
      }
      setStore({
        ts,
        url: body.url,
        meta: new Map((body.meta as FamilyMeta[]).map((m) => [m.name, m])),
        latest,
        warnings: Array.isArray(body.errors) ? body.errors : [],
        history: history.current,
      })
      setError(null)
    } catch (e) {
      setError({ message: (e as Error).message })
    }
  }, [])

  useEffect(() => {
    void poll()
    if (paused) return
    const id = setInterval(() => void poll(), intervalMs)
    return () => clearInterval(id)
  }, [poll, intervalMs, paused])

  const reset = useCallback(() => {
    history.current = new Map()
    setStore(null)
  }, [])

  return { store, error, reset }
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export interface Line {
  label: string
  points: Point[]
}

type Where = Record<string, string | string[]>

function matches(labels: Record<string, string>, where?: Where) {
  if (!where) return true
  return Object.entries(where).every(([k, v]) => (Array.isArray(v) ? v.includes(labels[k] ?? "") : labels[k] === v))
}

/** Value series of `name`, summed over the series that match `where`, one Line per value of `by`. */
export function lines(store: MetricsStore, name: string, opts: { by?: string; where?: Where; since?: number } = {}): Line[] {
  const groups = new Map<string, Map<number, number>>()
  for (const s of store.history.values()) {
    if (s.name !== name || !matches(s.labels, opts.where)) continue
    const label = opts.by ? (s.labels[opts.by] ?? "(vazio)") : name
    const g = groups.get(label) ?? new Map<number, number>()
    for (const [t, v] of s.points) {
      if (opts.since && t < opts.since) continue
      g.set(t, (g.get(t) ?? 0) + v)
    }
    groups.set(label, g)
  }
  return [...groups.entries()].map(([label, m]) => ({
    label,
    points: [...m.entries()].sort((a, b) => a[0] - b[0]) as Point[],
  }))
}

/** Counter -> per-second rate (resets count as zero growth). */
export function rate(points: Point[]): Point[] {
  const out: Point[] = []
  for (let i = 1; i < points.length; i++) {
    const [t0, v0] = points[i - 1]!
    const [t1, v1] = points[i]!
    const dt = (t1 - t0) / 1000
    if (dt > 0) out.push([t1, Math.max(0, v1 - v0) / dt])
  }
  return out
}
export const rates = (ls: Line[]): Line[] => ls.map((l) => ({ ...l, points: rate(l.points) }))

export const latestValue = (l: Line | undefined) => l?.points[l.points.length - 1]?.[1] ?? null

/** Sum of the latest value of every series matching the filters. */
export function total(store: MetricsStore, name: string, where?: Where): number | null {
  let sum = 0
  let any = false
  for (const s of store.latest) {
    if (s.name === name && matches(s.labels, where)) {
      sum += s.value
      any = true
    }
  }
  return any ? sum : null
}

/** Latest value per label value (summed over the rest), descending. */
export function breakdown(store: MetricsStore, name: string, by: string, where?: Where) {
  const m = new Map<string, number>()
  for (const s of store.latest) {
    if (s.name === name && matches(s.labels, where)) m.set(s.labels[by] ?? "(vazio)", (m.get(s.labels[by] ?? "(vazio)") ?? 0) + s.value)
  }
  return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
}

export const has = (store: MetricsStore, name: string) => store.meta.has(name) || store.latest.some((s) => s.name === name)

// --- histograms ---

export interface Bucket {
  le: number
  count: number
}
/** Cumulative buckets (sum over matching series) from a Prometheus histogram family. */
export function buckets(store: MetricsStore, base: string, where?: Where, at: "latest" | { since: number } = "latest"): { buckets: Bucket[]; sum: number; count: number } {
  const acc = new Map<number, number>()
  let sum = 0
  let count = 0
  const read = (name: string, pick: (s: { points: Point[] }) => number, filter: (l: Record<string, string>) => boolean, add: (labels: Record<string, string>, v: number) => void) => {
    for (const s of store.history.values()) {
      if (s.name === name && filter(s.labels)) add(s.labels, pick(s))
    }
  }
  const pick = (s: { points: Point[] }) => {
    const last = s.points[s.points.length - 1]?.[1] ?? 0
    if (at === "latest") return last
    const since = at.since
    const first = s.points.find((p) => p[0] >= since) ?? s.points[0]
    return Math.max(0, last - (first?.[1] ?? 0))   // growth inside the window
  }
  read(base + "_bucket", pick, (l) => matches(l, where), (l, v) => {
    const le = l.le === "+Inf" ? Infinity : Number(l.le)
    acc.set(le, (acc.get(le) ?? 0) + v)
  })
  read(base + "_sum", pick, (l) => matches(l, where), (_l, v) => (sum += v))
  read(base + "_count", pick, (l) => matches(l, where), (_l, v) => (count += v))
  return { buckets: [...acc.entries()].map(([le, count]) => ({ le, count })).sort((a, b) => a.le - b.le), sum, count }
}

/** histogram_quantile over cumulative buckets (linear interpolation, like Prometheus). */
export function quantile(bs: Bucket[], q: number): number | null {
  const total = bs[bs.length - 1]?.count ?? 0
  if (!total) return null
  const rank = q * total
  let prevCount = 0
  let prevLe = 0
  for (const b of bs) {
    if (b.count >= rank) {
      if (!Number.isFinite(b.le)) return prevLe
      const inBucket = b.count - prevCount
      return inBucket <= 0 ? b.le : prevLe + ((b.le - prevLe) * (rank - prevCount)) / inBucket
    }
    prevCount = b.count
    prevLe = Number.isFinite(b.le) ? b.le : prevLe
  }
  return prevLe
}

/** Per-poll average of a histogram (Δsum/Δcount) as a time series. */
export function histogramAvg(store: MetricsStore, base: string, where?: Where): Point[] {
  const sums = lines(store, base + "_sum", { where })[0]?.points ?? []
  const counts = lines(store, base + "_count", { where })[0]?.points ?? []
  const out: Point[] = []
  for (let i = 1; i < Math.min(sums.length, counts.length); i++) {
    const dc = counts[i]![1] - counts[i - 1]![1]
    if (dc > 0) out.push([sums[i]![0], (sums[i]![1] - sums[i - 1]![1]) / dc])
  }
  return out
}

/** Non-cumulative distribution for a bar chart. */
export function distribution(bs: Bucket[]): { label: string; value: number }[] {
  const out: { label: string; value: number }[] = []
  let prevCount = 0
  let prevLe = 0
  for (const b of bs) {
    const value = b.count - prevCount
    out.push({ label: Number.isFinite(b.le) ? `≤ ${b.le}` : `> ${prevLe}`, value })
    prevCount = b.count
    if (Number.isFinite(b.le)) prevLe = b.le
  }
  return out
}

// --- formatting ---

export function fmtNum(v: number | null, digits = 1): string {
  if (v === null || !Number.isFinite(v)) return "—"
  const a = Math.abs(v)
  if (a >= 1e9) return (v / 1e9).toFixed(digits) + "G"
  if (a >= 1e6) return (v / 1e6).toFixed(digits) + "M"
  if (a >= 1e4) return (v / 1e3).toFixed(digits) + "k"
  if (a >= 100 || Number.isInteger(v)) return v.toFixed(0)
  return v.toFixed(a >= 10 ? 1 : 2)
}
export function fmtSeconds(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—"
  if (v < 1e-3) return (v * 1e6).toFixed(0) + " µs"
  if (v < 1) return (v * 1e3).toFixed(v < 0.01 ? 2 : 1) + " ms"
  return v.toFixed(2) + " s"
}
export function fmtBytes(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—"
  const units = ["B", "KiB", "MiB", "GiB", "TiB"]
  let x = v
  let i = 0
  while (Math.abs(x) >= 1024 && i < units.length - 1) {
    x /= 1024
    i++
  }
  return `${x.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}
