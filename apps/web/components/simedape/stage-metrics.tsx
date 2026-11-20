"use client"

import { useEffect, useState } from "react"
import { useI18n } from "@/components/i18n-provider"
import { getRunMetrics, runMetricsDownloadUrl, type StageMetrics } from "@/lib/simedape-api"

const numeric = (value: number | null | undefined, digits = 1) => value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits)
const memory = (value: number | null | undefined) => {
  if (value == null) return "—"
  const unit = value >= 1073741824 ? [1073741824, "GiB"] as const : value >= 1048576 ? [1048576, "MiB"] as const : [1024, "KiB"] as const
  return `${numeric(value / unit[0], 2)} ${unit[1]}`
}
const seconds = (value: number | null | undefined) => value == null ? "—" : value >= 3600 ? `${numeric(value / 3600)} h` : value >= 60 ? `${numeric(value / 60)} min` : `${numeric(value)} s`

function Trace({ samples, field, label, bytes = false }: { samples: NonNullable<StageMetrics["samples"]>; field: string; label: string; bytes?: boolean }) {
  const points = samples.filter((s) => s.resources[field] != null && Number.isFinite(s.resources[field]))
  if (!points.length) return null
  const minTime = samples[0]?.elapsed_seconds ?? 0
  const span = Math.max(1, (samples.at(-1)?.elapsed_seconds ?? minTime) - minTime)
  const max = Math.max(1, ...points.map((p) => p.resources[field]!))
  const path = points.map((p) => `${10 + 280 * (p.elapsed_seconds - minTime) / span},${75 - 65 * p.resources[field]! / max}`).join(" ")
  return <figure className="min-w-0 rounded border border-border p-2">
    <figcaption className="mb-1 flex justify-between"><span>{label}</span><span>{bytes ? memory(max) : `${numeric(max)} cores`}</span></figcaption>
    <svg viewBox="0 0 300 85" className="h-24 w-full" role="img" aria-label={label}>
      <path d="M10 10 V75 H290" fill="none" stroke="currentColor" opacity="0.2" />
      <polyline points={path} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
    <div className="flex justify-between text-muted-foreground"><span>{seconds(minTime)}</span><span>{seconds(minTime + span)}</span></div>
  </figure>
}

export function StageMetricsView({ metrics: m, runId }: { metrics: StageMetrics; runId: string }) {
  const { t, intlLocale } = useI18n()
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState<StageMetrics | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    let cancelled = false
    const load = () => getRunMetrics(runId).then((result) => {
      if (!cancelled) { setHistory(result.stages.find((s) => s.index === m.index) ?? null); setError(null) }
    }).catch((e: Error) => { if (!cancelled) setError(e.message) })
    void load()
    const timer = m.status === "running" ? setInterval(() => void load(), 5000) : null
    return () => { cancelled = true; if (timer) clearInterval(timer) }
  }, [open, runId, m.index, m.status])
  const phase = m.phases.find((p) => p.name === m.current_phase)
  const resources = m.resources
  const latest = resources.latest
  const work = phase?.work
  const count = (n: number) => n.toLocaleString(intlLocale)
  const phaseRows = m.phases
  const estimation = m.details.estimation_progress as { group: number; groups: number; finished_variants: number; selected_variants: number } | undefined
  const comparison = m.details.comparison_progress as { finished_variants: number; selected_variants: number; variant: string } | undefined
  return <div className="w-full space-y-2 border-t border-border pt-2 text-[11px]">
    {estimation && <p className="flex flex-wrap justify-between gap-2 font-medium">
      <span>{t("Interpolation group")}: {estimation.group} / {estimation.groups}</span>
      <span>{t("Finished variants")}: {estimation.finished_variants} / {estimation.selected_variants}</span>
    </p>}
    {comparison && <div className="space-y-1">
      <p className="flex flex-wrap justify-between gap-2 font-medium"><span>{t("Comparing variant")}: {comparison.variant}</span>
        <span>{t("Compared variants")}: {comparison.finished_variants} / {comparison.selected_variants}</span></p>
      {comparison.selected_variants > 0 && <progress className="h-1.5 w-full" value={comparison.finished_variants} max={comparison.selected_variants} aria-label={t("Compared variants")} />}
    </div>}
    {phase && <div className="space-y-1">
      <div className="flex flex-wrap justify-between gap-1"><b className="font-mono">{t(phase.name)}</b>
        {work?.completed != null && <span>{work.unit === "bytes" ? memory(work.completed) : count(work.completed)}{work.total != null && ` / ${work.unit === "bytes" ? memory(work.total) : count(work.total)}`} {work.unit === "bytes" ? "" : work.unit}</span>}
      </div>
      {work?.percent != null && <div className="flex items-center gap-2">
        <progress className="h-1.5 flex-1" value={work.percent} max={100} aria-label={phase.name} />
        <span>{numeric(work.percent)}%</span>
      </div>}
      {work?.rate_per_second != null && <p className="text-muted-foreground">{work.unit === "bytes" ? memory(work.rate_per_second) : `${numeric(work.rate_per_second)} ${work.unit}`}/s
        {work.eta_seconds != null && work.eta_seconds > 0 && <> · {t("Estimated phase remaining")}: {seconds(work.eta_seconds)}</>}
      </p>}
      {work?.percent != null && <p className="text-[10px] text-muted-foreground">{t("Progress and ETA apply to this operation only.")}</p>}
      {Object.keys(phase.details).length > 0 && <p className="break-words font-mono text-[10px] text-muted-foreground">{Object.entries(phase.details).map(([key, value]) => `${key}=${typeof value === "object" ? JSON.stringify(value) : value}`).join(" · ")}</p>}
    </div>}
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
      {[
        [t("CPU cores"), numeric(latest.cpu_cores)],
        [t("CPU capacity"), `${numeric(latest.cpu_percent_capacity)}%`],
        [t("CPU time"), seconds(resources.cpu_seconds)],
        [t("Mean CPU cores"), numeric(resources.cpu_cores_mean)],
        [t("Heap / limit"), `${memory(latest.heap_used_bytes)} / ${memory(latest.heap_max_bytes)}`],
        [t("Peak heap"), memory(resources.peaks.heap_used_bytes)],
        [t("Process RSS"), memory(latest.rss_bytes)],
        [t("Peak RSS"), memory(resources.peaks.rss_bytes)],
        [t("GC time / collections"), `${seconds(resources.gc_seconds)} / ${numeric(resources.gc_collections, 0)}`],
        [t("Direct / mapped buffers"), `${memory(latest.direct_buffer_bytes)} / ${memory(latest.mapped_buffer_bytes)}`],
        [t("Disk read / write"), `${memory(resources.disk_read_bytes)} / ${memory(resources.disk_write_bytes)}`],
        [t("JVM threads"), numeric(latest.threads, 0)],
      ].map(([label, value]) => <div key={label}><dt className="text-[10px] text-muted-foreground">{label}</dt><dd className="font-mono text-[10px]">{value}</dd></div>)}
    </dl>
    {m.storage && <p className="break-all text-[10px] text-muted-foreground">{t("Output disk free / total")}: {memory(m.storage.usable_bytes)} / {memory(m.storage.total_bytes)} · {m.storage.filesystem} · {m.storage.path}</p>}
    {m.storage?.below_minimum && <p className="text-amber-600">{t("Low free disk space on the output filesystem. Free space or move SimEDaPE data before another training run.")}</p>}
    <p className="text-[10px] text-muted-foreground">{t("JVM process metrics include concurrent jobs. CPU cores may exceed 1. Peaks are sampled.")} · {t("Updated")}: {new Date(m.sampled_at * 1000).toLocaleTimeString(intlLocale)}</p>
    {m.collection_errors > 0 && <p className="text-amber-600">{t("Metrics collection errors")}: {m.collection_errors} · {m.last_collection_error}</p>}
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-muted-foreground">{t("Phase metrics and resource history")}</summary>
      <div className="mt-2 space-y-2">
        <div className="overflow-x-auto"><table className="w-full text-right text-[10px]">
          <thead><tr>{["Phase", "Calls", "Elapsed", "CPU time", "Mean cores", "Peak heap", "Peak RSS", "Status"].map((label) => <th key={label} className="whitespace-nowrap px-1 text-muted-foreground first:text-left">{t(label)}</th>)}</tr></thead>
          <tbody>{phaseRows.map((p) => <tr key={p.name} className="border-t border-border">
            <td className="px-1 py-1 text-left font-mono">{p.name}</td><td>{p.invocations}</td><td>{seconds(p.elapsed_seconds)}</td><td>{seconds(p.resources.cpu_seconds)}</td>
            <td>{numeric(p.resources.cpu_cores_mean)}</td><td>{memory(p.resources.peaks.heap_used_bytes)}</td><td>{memory(p.resources.peaks.rss_bytes)}</td><td>{t(p.status)}</td>
          </tr>)}</tbody>
        </table></div>
        {Object.keys(m.details).length > 0 && <pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-[10px]">{JSON.stringify(m.details, null, 2)}</pre>}
        {error && <p className="text-destructive">{error}</p>}
        {history?.samples && <>
          <p className="text-[10px] text-muted-foreground">{t("Recent bounded samples; phase totals cover the full stage.")}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Trace samples={history.samples} field="cpu_cores" label={t("CPU cores")} />
            <Trace samples={history.samples} field="rss_bytes" label={t("Process RSS")} bytes />
          </div>
        </>}
        <a className="inline-block underline" href={runMetricsDownloadUrl(runId)} download>{t("Download run metrics (JSON)")}</a>
      </div>
    </details>
  </div>
}
