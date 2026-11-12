"use client"

import { createTranslator, DEFAULT_LOCALE, INTL_LOCALES, type Locale } from "@/lib/i18n"
import { toJpeg, toPng } from "html-to-image"
import type { Line, MetricsStore } from "@/lib/metrics-store"

/** What a panel can hand to the export menu. */
export type ExportData =
  | { kind: "series"; series: Line[]; unit?: string; timeAxis?: "elapsed" }
  | { kind: "bars"; items: { label: string; value: number }[]; unit?: string }
  | { kind: "bins"; bins: { label: string; value: number }[]; quantiles?: { q: string; v: number | null }[]; unit?: string }
  | { kind: "table"; plot?: "scatter" | "row-lines" | "column-lines" | "grouped-bars"; columns: string[]; rows: (string | number | null)[][]; unit?: string }
  | { kind: "matrix"; rows: string[]; cols: string[]; cells: number[][]; rowLabel: string; colLabel: string; unit?: string }

export interface ExportMeta {
  source: string
  windowLabel: string
  generatedAt: number
  section?: string
  locale?: Locale
}

const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "painel"
const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-")

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const csvCell = (v: string | number | null) => {
  if (v === null) return ""
  const s = String(v)
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const csv = (rows: (string | number | null)[][]) => "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n"
const iso = (ms: number) => new Date(ms).toISOString()

/** Rows for a panel. `wide`: one column per series aligned on timestamps; otherwise long format. */
export function panelCsv(data: ExportData, wide = true): string {
  if (data.kind === "series" && data.timeAxis === "elapsed") {
    if (!wide) return csv([["elapsed_seconds", "series", "value", "unit"],
      ...data.series.flatMap(line => line.points.map(([ms, value]) => [ms/1000, line.label, value, data.unit ?? ""]))])
    const times = [...new Set(data.series.flatMap(line => line.points.map(p => p[0])))].sort((a,b) => a-b)
    const maps = data.series.map(line => new Map(line.points))
    return csv([["elapsed_seconds", ...data.series.map(line => line.label)],
      ...times.map(ms => [ms/1000, ...maps.map(map => map.get(ms) ?? null)])])
  }
  if (data.kind === "series") {
    const unit = data.unit ?? ""
    if (!wide) {
      const rows: (string | number | null)[][] = [["timestamp", "epoch_ms", "series", "value", "unit"]]
      for (const l of data.series) for (const [t, v] of l.points) rows.push([iso(t), t, l.label, v, unit])
      return csv(rows)
    }
    const times = [...new Set(data.series.flatMap((l) => l.points.map((p) => p[0])))].sort((a, b) => a - b)
    const maps = data.series.map((l) => new Map(l.points))
    const rows: (string | number | null)[][] = [["timestamp", "epoch_ms", ...data.series.map((l) => (unit ? `${l.label} (${unit})` : l.label))]]
    for (const t of times) rows.push([iso(t), t, ...maps.map((m) => m.get(t) ?? null)])
    return csv(rows)
  }
  if (data.kind === "table") return csv([data.columns, ...data.rows])
  if (data.kind === "matrix") return csv([[`${data.rowLabel} \\ ${data.colLabel}`, ...data.cols], ...data.rows.map((r, i) => [r, ...data.cells[i]!])])
  if (data.kind === "bars") return csv([["label", data.unit ? `value (${data.unit})` : "value"], ...data.items.map((i) => [i.label, i.value])])
  return csv([["bin", "count"], ...data.bins.map((b) => [b.label, b.value]), ...(data.quantiles ?? []).map((q) => [`quantile ${q.q}`, q.v])])
}

const TEX: Record<string, string> = { "&": "\\&", "%": "\\%", _: "\\_", "#": "\\#", $: "\\$", "{": "\\{", "}": "\\}", "~": "\\textasciitilde{}", "^": "\\textasciicircum{}", "\\": "\\textbackslash{}" }
const texEscape = (v: string | number | null) => String(v ?? "").replace(/[&%_#${}~^\\]/g, (c) => TEX[c] ?? c)
const texNum = (v: string | number | null) => (typeof v === "number" ? (Number.isFinite(v) ? String(v) : "--") : v === null ? "--" : texEscape(v))

/** Complete, full-precision booktabs/longtable data, including time series. */
export function panelLatex(title: string, data: ExportData): string | null {
  if (data.kind === "series" && data.timeAxis === "elapsed") return panelLatex(title, {kind:"table",
    columns:["elapsed_seconds", "series", "value"], rows:data.series.flatMap(line => line.points.map(([ms,v]) => [ms/1000,line.label,v]))})
  let header: string[]
  let rows: (string | number | null)[][]
  if (data.kind === "table") [header, rows] = [data.columns, data.rows]
  else if (data.kind === "matrix") [header, rows] = [[`${data.rowLabel} / ${data.colLabel}`, ...data.cols], data.rows.map((r, i) => [r, ...data.cells[i]!])]
  else if (data.kind === "bars") [header, rows] = [["label", data.unit ? `value (${data.unit})` : "value"], data.items.map((i) => [i.label, i.value])]
  else if (data.kind === "bins") [header, rows] = [["bin / quantile", "value"], [...data.bins.map((b) => [b.label, b.value] as (string | number | null)[]), ...(data.quantiles ?? []).map((q) => [`quantile ${q.q}`, q.v])]]
  else if (data.kind === "series") {
    header = ["timestamp (UTC)", "epoch_ms", "series", data.unit ? `value (${data.unit})` : "value"]
    rows = data.series.flatMap((line) => line.points.map(([t, v]) => [iso(t), t, line.label, v]))
  }
  else return null
  const label = "tab:" + slug(title)
  return [
    "% Requires \\usepackage{booktabs,longtable}", "\\begin{longtable}{l" + "r".repeat(header.length - 1) + "}", `\\caption{${texEscape(title)}${data.unit ? ` (${texEscape(data.unit)})` : ""}}`, `\\label{${label}}\\\\`,
    "\\toprule", header.map(texEscape).join(" & ") + " \\\\", "\\midrule",
    ...rows.map((r) => [texEscape(r[0] ?? ""), ...r.slice(1).map(texNum)].join(" & ") + " \\\\"),
    "\\bottomrule", "\\end{longtable}", "",
  ].join("\n")
}

export function exportPanelLatex(title: string, data: ExportData, meta: ExportMeta) {
  const tex = panelLatex(title, data)
  if (tex === null) throw new Error("Este painel não é uma tabela.")
  download(new Blob([tex], { type: "text/plain;charset=utf-8" }), `${slug(title)}-${stamp(meta.generatedAt)}.tex`)
}

export function panelJson(title: string, data: ExportData, meta: ExportMeta): string {
  if (data.kind === "series" && data.timeAxis === "elapsed")
    return JSON.stringify({ panel: title, source: meta.source, timeAxis: "elapsed_seconds", unit: data.unit,
      series: data.series.map(line => ({ label: line.label, points: line.points.map(([ms,v]) => ({elapsed_seconds: ms/1000, v})) })) }, null, 2)
  const base = { panel: title, section: meta.section, source: meta.source, window: meta.windowLabel, generatedAt: iso(meta.generatedAt), unit: data.unit ?? null }
  if (data.kind === "series")
    return JSON.stringify({ ...base, series: data.series.map((l) => ({ label: l.label, points: l.points.map(([t, v]) => ({ t: iso(t), epoch_ms: t, v })) })) }, null, 2)
  if (data.kind === "table") return JSON.stringify({ ...base, columns: data.columns, rows: data.rows.map((r) => Object.fromEntries(data.columns.map((c, i) => [c, r[i]]))) }, null, 2)
  if (data.kind === "matrix") return JSON.stringify({ ...base, rowLabel: data.rowLabel, colLabel: data.colLabel, rows: data.rows, cols: data.cols, cells: data.cells }, null, 2)
  if (data.kind === "bars") return JSON.stringify({ ...base, items: data.items }, null, 2)
  return JSON.stringify({ ...base, bins: data.bins, quantiles: data.quantiles }, null, 2)
}

export function exportPanelData(title: string, data: ExportData, meta: ExportMeta, format: "csv" | "csv-long" | "json") {
  const name = `${slug(title)}-${stamp(meta.generatedAt)}`
  if (format === "json") download(new Blob([panelJson(title, data, meta)], { type: "application/json" }), `${name}.json`)
  else download(new Blob([panelCsv(data, format === "csv")], { type: "text/csv;charset=utf-8" }), `${name}${format === "csv-long" ? "-longo" : ""}.csv`)
}

// --- raw dump of everything collected --------------------------------------------------------

export function exportAll(store: MetricsStore, format: "csv" | "json") {
  const name = `metricas-htc-${stamp(store.ts)}`
  if (format === "csv") {
    const chunks: string[] = ["﻿timestamp,epoch_ms,metric,labels,value\r\n"]
    for (const s of store.history.values()) {
      const labels = Object.entries(s.labels).map(([k, v]) => `${k}=${v}`).join(";")
      for (const [t, v] of s.points) chunks.push(`${iso(t)},${t},${csvCell(s.name)},${csvCell(labels)},${v}\r\n`)
    }
    download(new Blob(chunks, { type: "text/csv;charset=utf-8" }), `${name}.csv`)
    return
  }
  const out = {
    source: store.url,
    generatedAt: iso(store.ts),
    metrics: [...new Set([...store.history.values()].map((s) => s.name))].map((m) => ({ name: m, ...(store.meta.get(m) ? { type: store.meta.get(m)!.type, help: store.meta.get(m)!.help } : {}) })),
    series: [...store.history.values()].map((s) => ({ metric: s.name, labels: s.labels, points: s.points.map(([t, v]) => [t, v]) })),
  }
  download(new Blob([JSON.stringify(out)], { type: "application/json" }), `${name}.json`)
}

// --- images ----------------------------------------------------------------------------------

const ignore = (node: HTMLElement) => !(node instanceof HTMLElement && node.dataset.exportIgnore !== undefined)

function backgroundOf(node: HTMLElement): string {
  for (let el: HTMLElement | null = node; el; el = el.parentElement) {
    const c = getComputedStyle(el).backgroundColor
    if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") return c
  }
  return "#ffffff"
}

export async function nodeToDataUrl(node: HTMLElement, type: "png" | "jpeg", scale = 3): Promise<string> {
  // skipFonts: the web-font stylesheet is cross-origin (Google Fonts) and cannot be read; the image falls back to the system sans font.
  const opts = { pixelRatio: scale, backgroundColor: backgroundOf(node), filter: ignore, cacheBust: true, quality: 0.95, skipFonts: true }
  return type === "png" ? toPng(node, opts) : toJpeg(node, opts)
}

export async function exportPanelImage(node: HTMLElement, title: string, meta: ExportMeta, type: "png" | "jpeg") {
  const url = await nodeToDataUrl(node, type)
  download(await (await fetch(url)).blob(), `${slug(title)}-${stamp(meta.generatedAt)}.${type === "jpeg" ? "jpg" : "png"}`)
}

/** Vector export of the first <svg> inside the node (line charts); colours are resolved so it opens anywhere. */
export function exportPanelSvg(node: HTMLElement, title: string, meta: ExportMeta): boolean {
  const svg = node.querySelector("svg")
  if (!svg) return false
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg")
  const color = getComputedStyle(svg).color
  const vb = svg.viewBox.baseVal
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect")
  bg.setAttribute("width", String(vb.width))
  bg.setAttribute("height", String(vb.height))
  bg.setAttribute("fill", backgroundOf(node))
  clone.insertBefore(bg, clone.firstChild)
  let text = new XMLSerializer().serializeToString(clone).replace(/currentColor/g, color)
  text = `<?xml version="1.0" encoding="UTF-8"?>\n<!-- ${title} · ${meta.source} · ${iso(meta.generatedAt)} -->\n${text}`
  download(new Blob([text], { type: "image/svg+xml" }), `${slug(title)}-${stamp(meta.generatedAt)}.svg`)
  return true
}

// --- PDF report --------------------------------------------------------------------------------

export interface ReportSection {
  title: string
  /** Panel images (JPEG data URLs) captured while the section was on screen. */
  panels: { title: string; url: string; wide: boolean }[]
}

/** Captures `[data-panel]` elements as JPEG data URLs (must be called while they are mounted). */
export async function capturePanels(root: HTMLElement): Promise<ReportSection["panels"]> {
  const out: ReportSection["panels"] = []
  const rootW = root.getBoundingClientRect().width || 1
  for (const node of root.querySelectorAll<HTMLElement>("[data-panel]")) {
    const wide = node.getBoundingClientRect().width / rootW > 0.7      // spans the row on screen: keep it that way
    // JPEG keeps the PDF small (PNG made a 5-panel section weigh ~23 MB); single-panel PNG exports stay lossless.
    out.push({ title: node.dataset.panelTitle ?? "", url: await nodeToDataUrl(node, "jpeg", 2), wide })
  }
  return out
}

/** A4 landscape report: cover, then every panel as an image, two per row. */
export async function exportReportPdf(sections: ReportSection[], meta: ExportMeta, title = "Relatório de métricas do HTC") {
  const locale = meta.locale ?? DEFAULT_LOCALE
  const t = createTranslator(locale)
  title = t(title)
  const { jsPDF } = await import("jspdf")
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" })
  const W = pdf.internal.pageSize.getWidth()
  const H = pdf.internal.pageSize.getHeight()
  const M = 12
  let page = 1
  const footer = () => {
    pdf.setFontSize(8)
    pdf.setTextColor(120)
    pdf.text(`${title} · ${iso(meta.generatedAt)}`, M, H - 6)
    pdf.text(String(page), W - M, H - 6, { align: "right" })
    pdf.setTextColor(0)
  }
  pdf.setFontSize(20)
  pdf.text(title, M, 30)
  pdf.setFontSize(10)
  const lines = [
    t("Fonte: {0}", { 0: meta.source }),
    t("Janela: {0}", { 0: meta.windowLabel }),
    t("Gerado em: {0}", { 0: new Date(meta.generatedAt).toLocaleString(INTL_LOCALES[locale]) }),
    t("Seções: {0}", { 0: sections.map((s) => t(s.title)).join(", ") }),
  ]
  lines.forEach((l, i) => pdf.text(pdf.splitTextToSize(l, W - 2 * M), M, 42 + i * 7))
  footer()

  const colW = (W - 2 * M - 6) / 2
  const fullW = W - 2 * M
  for (const section of sections) {
    pdf.addPage()
    page++
    pdf.setFontSize(14)
    pdf.text(t(section.title), M, M + 4)
    let x = M
    let y = M + 12
    let rowH = 0
    const newRow = () => {
      y += rowH + 4
      x = M
      rowH = 0
    }
    for (const p of section.panels) {
      const img = new Image()
      img.src = p.url
      await img.decode()
      const full = p.wide
      const w = full ? fullW : colW
      const h = (img.height / img.width) * w
      if (full && x !== M) newRow()
      if (y + h > H - 14) {
        footer()
        pdf.addPage()
        page++
        y = M
        x = M
        rowH = 0
      }
      pdf.addImage(p.url, "JPEG", x, y, w, h, undefined, "FAST")
      rowH = Math.max(rowH, h)
      if (full || x !== M) newRow()
      else x = M + colW + 6
    }
    footer()
  }
  pdf.save(`relatorio-htc-${stamp(meta.generatedAt)}.pdf`)
}


/** Data registry is independent of screen clipping, chart sampling and table pagination. */
const panelData = new WeakMap<HTMLElement, ExportData>()
export function registerPanel(node: HTMLElement, data: ExportData) {
  panelData.set(node, data)
  return () => { panelData.delete(node) }
}
export interface ReportPanelInput { title: string; data: ExportData }
export interface DataPanel extends ReportPanelInput { csv: string; latex: string }
export function reportPanel(title: string, data: ExportData): DataPanel {
  return { title, data, csv: panelCsv(data), latex: panelLatex(title, data) ?? "" }
}
export function collectReportPanelData(root: HTMLElement): ReportPanelInput[] {
  return [...root.querySelectorAll<HTMLElement>("[data-panel]")].flatMap((node) => {
    const data = panelData.get(node)
    return data ? [{ title: node.dataset.panelTitle ?? "Panel", data }] : []
  })
}
export function collectReportPanels(root: HTMLElement): DataPanel[] {
  return collectReportPanelData(root).map(panel => reportPanel(panel.title, panel.data))
}
/** Yield between panels so long exports can paint progress and be cancelled. */
export async function prepareReportPanels(panels: ReportPanelInput[], options: {
  signal?: AbortSignal; progress?: (index: number, total: number) => void
} = {}): Promise<DataPanel[]> {
  const result: DataPanel[] = []
  for (const [index, panel] of panels.entries()) {
    options.signal?.throwIfAborted()
    options.progress?.(index + 1, panels.length)
    await new Promise(resolve => setTimeout(resolve, 0))
    options.signal?.throwIfAborted()
    result.push(reportPanel(panel.title, panel.data))
  }
  return result
}
export async function exportVectorReport(panels: DataPanel[], meta: ExportMeta, format: "pdf" | "zip", signal?: AbortSignal) {
  signal?.throwIfAborted()
  if (!panels.length) throw new Error("No panel data to export.")
  const response = await fetch("/api/reports/export", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ panels, meta, format }), signal,
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}))
    throw new Error(detail.error ?? `Report export failed (${response.status})`)
  }
  const blob = await response.blob()
  signal?.throwIfAborted()
  download(blob, `htc-report-${stamp(meta.generatedAt)}.${format}`)
}
