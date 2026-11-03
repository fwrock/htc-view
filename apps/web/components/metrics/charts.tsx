"use client"

import { useI18n } from "@/components/i18n-provider"

import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from "react"
import { cn } from "@workspace/ui/lib/utils"
import { exportPanelData, exportPanelImage, exportPanelLatex, exportPanelSvg, panelLatex, type ExportData, type ExportMeta } from "@/lib/metrics-export"
import type { Line } from "@/lib/metrics-store"

// Distinguishable in light and dark themes.
export const PALETTE = ["#2563eb", "#16a34a", "#d97706", "#db2777", "#7c3aed", "#0891b2", "#dc2626", "#65a30d", "#475569", "#ea580c"]

export const ExportContext = createContext<ExportMeta>({ source: "", windowLabel: "", generatedAt: 0 })

/** A titled card. Pass `data` to enable the Exportar menu (PNG, JPEG, SVG, CSV, JSON). */
export function Panel({
  title,
  hint,
  children,
  className,
  data,
}: {
  title: string
  hint?: string
  children: React.ReactNode
  className?: string
  data?: ExportData
}) {
  const { t: translateText } = useI18n()

  const ref = useRef<HTMLElement>(null)
  const meta = useContext(ExportContext)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", close)
    document.addEventListener("keydown", close)
    return () => {
      document.removeEventListener("mousedown", close)
      document.removeEventListener("keydown", close)
    }
  }, [open])

  async function run(action: (node: HTMLElement, m: ExportMeta) => void | Promise<void | boolean>) {
    setOpen(false)
    setBusy(true)
    setError(null)
    try {
      // The clock and the DOM node are read here, when you click, not while rendering.
      await action(ref.current!, { ...meta, generatedAt: Date.now() })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const hasSvg = data?.kind === "series"
  const items: { label: string; action: (node: HTMLElement, m: ExportMeta) => void | Promise<void | boolean>; show: boolean }[] = [
    { label: "Imagem PNG", show: true, action: (n, m) => exportPanelImage(n, title, m, "png") },
    { label: "Imagem JPEG", show: true, action: (n, m) => exportPanelImage(n, title, m, "jpeg") },
    { label: "Vetor SVG", show: hasSvg, action: (n, m) => { if (!exportPanelSvg(n, title, m)) throw new Error("Este painel não tem gráfico vetorial.") } },
    { label: data?.kind === "series" ? "CSV (uma coluna por série)" : "CSV", show: !!data, action: (_n, m) => exportPanelData(title, data!, m, "csv") },
    { label: "CSV (formato longo)", show: data?.kind === "series", action: (_n, m) => exportPanelData(title, data!, m, "csv-long") },
    { label: "JSON", show: !!data, action: (_n, m) => exportPanelData(title, data!, m, "json") },
    { label: "LaTeX (tabela)", show: !!data && panelLatex(title, data) !== null, action: (_n, m) => exportPanelLatex(title, data!, m) },
  ]

  return (
    <section ref={ref} data-panel data-panel-title={translateText(title)} className={cn("relative flex min-w-0 flex-col gap-2 rounded-sm border border-border bg-card p-3", className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold">{translateText(title)}</h3>
          {hint && <p className="text-[10px] leading-snug text-muted-foreground">{translateText(hint)}</p>}
        </div>
        <div data-export-ignore className="relative shrink-0">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={translateText("Exportar {0}", { 0: title })}
            title={translateText("Exportar")}
            disabled={busy}
            onClick={() => setOpen((o) => !o)}
            className="rounded-sm border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {busy ? translateText("…") : translateText("Exportar ▾")}
          </button>
          {open && (
            <ul role="menu" className="absolute right-0 z-20 mt-1 min-w-44 rounded-sm border border-border bg-popover p-1 text-[11px] shadow-md">
              {items.filter((i) => i.show).map((i) => (
                <li key={i.label} role="none">
                  <button type="button" role="menuitem" className="w-full rounded-sm px-2 py-1 text-left hover:bg-muted" onClick={() => void run(i.action)}>
                    {translateText(i.label)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {children}
      {error && <p data-export-ignore role="alert" className="text-[10px] text-destructive">{translateText(error)}</p>}
    </section>
  )
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  const { t: translateText } = useI18n()

  return (
    <div className="rounded-sm border border-border bg-card px-3 py-2">
      <p className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">{translateText(label)}</p>
      <p className="mt-1 font-mono text-lg font-semibold tabular-nums">{translateText(value)}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{translateText(sub)}</p>}
    </div>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  

  return <p className="py-6 text-center text-[11px] text-muted-foreground">{children}</p>
}

const clock = (ms: number, intlLocale: string) => new Date(ms).toLocaleTimeString(intlLocale, { hour12: false })

/** Multi-series line chart over time, with a hover read-out. */
export function LineChart({
  series,
  format = (v) => String(v),
  height = 150,
  maxSeries = 8,
  fill = false,
}: {
  series: Line[]
  format?: (v: number) => string
  height?: number
  maxSeries?: number
  fill?: boolean
}) {
  const { t: translateText, intlLocale } = useI18n()

  const id = useId()
  const [hover, setHover] = useState<number | null>(null)
  const W = 520
  const H = height
  const pad = { l: 44, r: 8, t: 6, b: 18 }

  const shown = useMemo(() => {
    const last = (l: Line) => l.points[l.points.length - 1]?.[1] ?? 0
    return [...series].filter((l) => l.points.length > 0).sort((a, b) => last(b) - last(a)).slice(0, maxSeries)
  }, [series, maxSeries])

  const all = shown.flatMap((l) => l.points)
  if (all.length < 2) return <Empty>{translateText("Coletando dados…")}</Empty>
  const t0 = Math.min(...all.map((p) => p[0]))
  const t1 = Math.max(...all.map((p) => p[0]))
  const yMax = Math.max(...all.map((p) => p[1]), 1e-9) * 1.08
  const yMin = Math.min(0, ...all.map((p) => p[1]))
  const x = (t: number) => pad.l + ((t - t0) / (t1 - t0 || 1)) * (W - pad.l - pad.r)
  const y = (v: number) => pad.t + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - pad.t - pad.b)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => yMin + f * (yMax - yMin))

  const hoverTs = hover === null ? null : t0 + hover * (t1 - t0)
  const nearest = (l: Line) => {
    if (hoverTs === null) return null
    return l.points.reduce<[number, number] | null>((best, p) => (best === null || Math.abs(p[0] - hoverTs) < Math.abs(best[0] - hoverTs) ? p : best), null)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const px = ((e.clientX - r.left) / r.width) * W
          setHover(Math.min(1, Math.max(0, (px - pad.l) / (W - pad.l - pad.r))))
        }}
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="currentColor" opacity={0.1} />
            <text x={pad.l - 4} y={y(v) + 3} textAnchor="end" fontSize={9} fill="currentColor" opacity={0.6}>
              {translateText(format(v))}
            </text>
          </g>
        ))}
        <text x={pad.l} y={H - 4} fontSize={9} fill="currentColor" opacity={0.6}>{clock(t0, intlLocale)}</text>
        <text x={W - pad.r} y={H - 4} textAnchor="end" fontSize={9} fill="currentColor" opacity={0.6}>{clock(t1, intlLocale)}</text>
        {shown.map((l, i) => {
          const color = PALETTE[i % PALETTE.length]
          const d = l.points.map((p, j) => `${j ? "L" : "M"}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join("")
          return (
            <g key={l.label}>
              {fill && shown.length === 1 && (
                <path d={`${d}L${x(t1)} ${y(0)}L${x(t0)} ${y(0)}Z`} fill={color} opacity={0.12} />
              )}
              <path d={d} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
            </g>
          )
        })}
        {hover !== null && (
          <g>
            <line x1={x(hoverTs!)} x2={x(hoverTs!)} y1={pad.t} y2={H - pad.b} stroke="currentColor" opacity={0.3} />
            {shown.map((l, i) => {
              const p = nearest(l)
              return p ? <circle key={l.label + id} cx={x(p[0])} cy={y(p[1])} r={2.5} fill={PALETTE[i % PALETTE.length]} /> : null
            })}
          </g>
        )}
      </svg>
      <ul className="flex flex-wrap gap-x-4 gap-y-0.5 text-[10px]">
        {shown.map((l, i) => {
          const p = hover !== null ? nearest(l) : l.points[l.points.length - 1]
          return (
            <li key={l.label} className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
              <span className="max-w-40 truncate text-muted-foreground">{translateText(l.label)}</span>
              <span className="font-mono tabular-nums">{p ? translateText(format(p[1])) : translateText("—")}</span>
            </li>
          )
        })}
        {hoverTs !== null && <li className="ml-auto font-mono text-muted-foreground">{clock(hoverTs, intlLocale)}</li>}
      </ul>
      {series.length > shown.length && <p className="text-[10px] text-muted-foreground">{translateText("Mostrando as ")}{shown.length}{translateText(" maiores de ")}{series.length}{translateText(" séries.")}</p>}
    </div>
  )
}

/** Horizontal bars, largest first. */
export function BarList({
  items,
  format = (v) => String(v),
  max = 10,
}: {
  items: { label: string; value: number }[]
  format?: (v: number) => string
  max?: number
}) {
  const { t: translateText } = useI18n()

  const shown = items.slice(0, max)
  if (shown.length === 0) return <Empty>{translateText("Sem dados.")}</Empty>
  const top = Math.max(...shown.map((i) => i.value), 1e-9)
  return (
    <ul className="flex flex-col gap-1">
      {shown.map((it, i) => (
        <li key={it.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2 text-[11px]">
          <span className="truncate" title={translateText(it.label)}>{translateText(it.label)}</span>
          <span className="h-2 rounded-sm bg-muted">
            <span className="block h-2 rounded-sm" style={{ width: `${(it.value / top) * 100}%`, background: PALETTE[i % PALETTE.length] }} />
          </span>
          <span className="font-mono tabular-nums">{translateText(format(it.value))}</span>
        </li>
      ))}
      {items.length > shown.length && <li className="text-[10px] text-muted-foreground">+ {items.length - shown.length}{translateText(" outros")}</li>}
    </ul>
  )
}

/** Histogram distribution as vertical bars plus p50/p95/p99. */
export function Distribution({
  bins,
  quantiles,
  format = (v) => String(v),
}: {
  bins: { label: string; value: number }[]
  quantiles: { q: string; v: number | null }[]
  format?: (v: number) => string
}) {
  const { t: translateText } = useI18n()

  const total = bins.reduce((a, b) => a + b.value, 0)
  if (total === 0) return <Empty>{translateText("Sem observações ainda.")}</Empty>
  const top = Math.max(...bins.map((b) => b.value), 1)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-x-4 text-[11px]">
        {quantiles.map((q) => (
          <span key={q.q}><span className="text-muted-foreground">{translateText(q.q)}</span> <span className="font-mono tabular-nums">{q.v === null ? translateText("—") : translateText(format(q.v))}</span></span>
        ))}
        <span className="text-muted-foreground">{translateText("n = ")}<span className="font-mono">{total}</span></span>
      </div>
      <div className="flex h-24 items-end gap-0.5" role="img" aria-label={translateText("Distribuição")}>
        {bins.map((b) => (
          <div key={b.label} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end" title={translateText("{0}: {1}", { 0: b.label, 1: b.value })}>
            <div className="w-full rounded-t-sm bg-primary/70" style={{ height: `${(b.value / top) * 100}%`, minHeight: b.value ? 2 : 0 }} />
          </div>
        ))}
      </div>
      <div className="flex gap-0.5 text-[8px] text-muted-foreground">
        {bins.map((b) => <span key={b.label} className="min-w-0 flex-1 truncate text-center" title={translateText(b.label)}>{translateText(b.label.replace("≤ ", ""))}</span>)}
      </div>
    </div>
  )
}

/** Gauge-like meter for a 0..1 ratio. */
export function Meter({ value, label }: { value: number | null; label: string }) {
  const { t: translateText } = useI18n()

  const pct = value === null ? 0 : Math.max(0, Math.min(1, value)) * 100
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-[11px]"><span>{translateText(label)}</span><span className="font-mono tabular-nums">{value === null ? translateText("—") : translateText(pct.toFixed(1) + "%")}</span></div>
      <div className="h-2 rounded-sm bg-muted"><div className={cn("h-2 rounded-sm", pct > 90 ? "bg-red-500" : pct > 75 ? "bg-yellow-500" : "bg-green-500")} style={{ width: `${pct}%` }} /></div>
    </div>
  )
}

/** From -> to matrix with colour intensity by value (e.g. messages sent from one node to another). */
export function Matrix({
  rows,
  cols,
  cells,
  rowLabel,
  colLabel,
  format = (v) => String(v),
}: {
  rows: string[]
  cols: string[]
  cells: number[][]
  rowLabel: string
  colLabel: string
  format?: (v: number) => string
}) {
  const { t: translateText } = useI18n()

  const top = Math.max(...cells.flat(), 1e-9)
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0.5 text-[11px]">
        <thead>
          <tr>
            <th className="px-2 py-1 text-left text-[10px] font-normal text-muted-foreground">{translateText(rowLabel)} ↓ · {translateText(colLabel)} →</th>
            {cols.map((c) => <th key={c} className="px-2 py-1 text-right font-medium">{translateText(c)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r}>
              <th className="px-2 py-1 text-left font-medium">{translateText(r)}</th>
              {cols.map((c, j) => {
                const v = cells[i]![j]!
                return (
                  <td key={c} className="rounded-sm px-2 py-1 text-right font-mono tabular-nums" title={translateText("{0} → {1}: {2}", { 0: r, 1: c, 2: format(v) })}
                    style={{ background: v > 0 ? `color-mix(in srgb, #2563eb ${Math.round(8 + (v / top) * 62)}%, transparent)` : undefined }}>
                    {v > 0 ? translateText(format(v)) : translateText("·")}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Grouped vertical bars: one group per category, one bar per series (e.g. MAPE per metric, per method). */
export function GroupedBars({
  categories,
  series,
  format = (v) => String(v),
  height = 190,
}: {
  categories: string[]
  series: { label: string; values: (number | null)[] }[]
  format?: (v: number) => string
  height?: number
}) {
  const { t: translateText } = useI18n()

  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null && Number.isFinite(v))
  if (categories.length === 0 || all.length === 0) return <Empty>{translateText("Sem dados.")}</Empty>
  const W = 560
  const H = height
  const pad = { l: 44, r: 8, t: 8, b: 40 }
  const top = Math.max(...all, 1e-9) * 1.1
  const groupW = (W - pad.l - pad.r) / categories.length
  const barW = Math.min(26, (groupW * 0.8) / series.length)
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top)
  return (
    <div className="flex flex-col gap-1.5">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="currentColor" opacity={0.1} />
            <text x={pad.l - 4} y={y(v) + 3} textAnchor="end" fontSize={9} fill="currentColor" opacity={0.6}>{translateText(format(v))}</text>
          </g>
        ))}
        {categories.map((c, ci) => {
          const gx = pad.l + ci * groupW + (groupW - barW * series.length) / 2
          return (
            <g key={c}>
              {series.map((s, si) => {
                const v = s.values[ci]
                if (v === null || v === undefined || !Number.isFinite(v)) return null
                return (
                  <rect key={s.label} x={gx + si * barW} y={y(v)} width={barW - 2} height={Math.max(1, y(0) - y(v))} rx={1.5} fill={PALETTE[si % PALETTE.length]}>
                    <title>{translateText("{0} · {1}: {2}", { 0: c, 1: s.label, 2: format(v) })}</title>
                  </rect>
                )
              })}
              <text x={pad.l + ci * groupW + groupW / 2} y={H - pad.b + 13} textAnchor="middle" fontSize={9} fill="currentColor" opacity={0.75}>
                {c.length > 14 ? translateText(c.slice(0, 13) + "…") : translateText(c)}
              </text>
            </g>
          )
        })}
      </svg>
      <ul className="flex flex-wrap gap-x-4 gap-y-0.5 text-[10px]">
        {series.map((s, i) => (
          <li key={s.label} className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="text-muted-foreground">{translateText(s.label)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
