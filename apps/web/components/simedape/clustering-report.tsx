"use client"

import { ReportDownloads } from "@/components/metrics/report-downloads"
import { useI18n } from "@/components/i18n-provider"

import { useEffect, useMemo, useState } from "react"
import { BarList, Distribution, Empty, ExportContext, Matrix, Panel, PALETTE, Stat } from "@/components/metrics/charts"
import { getClusteringReport, type ClusteringReport } from "@/lib/simedape-api"

const f = (v: number | null | undefined, d = 2, intlLocale: string) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toLocaleString(intlLocale, { maximumFractionDigits: d }))
const sel = "h-7 rounded-sm border border-input bg-background px-2 text-xs"

/** Plain SVG lines over the time steps, with the cluster centroid dashed. */
function SeriesPlot({ series, centroid, color }: { series: { label: string; values: number[] }[]; centroid: number[]; color: string }) {
  const { t: translateText, intlLocale } = useI18n()

  const W = 520
  const H = 170
  const pad = { l: 44, r: 8, t: 6, b: 16 }
  const all = [...series.flatMap((s) => s.values), ...centroid]
  if (all.length < 2) return <Empty>{translateText("Sem séries.")}</Empty>
  const lo = Math.min(...all)
  const hi = Math.max(...all)
  const span = hi - lo || 1
  const n = Math.max(centroid.length, ...series.map((s) => s.values.length))
  const x = (i: number) => pad.l + (i / Math.max(1, n - 1)) * (W - pad.l - pad.r)
  const y = (v: number) => pad.t + (1 - (v - lo) / span) * (H - pad.t - pad.b)
  const path = (vs: number[]) => vs.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={translateText("Séries do cluster")}>
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(lo + span * t)} y2={y(lo + span * t)} stroke="currentColor" opacity={0.12} />
          <text x={pad.l - 4} y={y(lo + span * t) + 3} textAnchor="end" fontSize={9} fill="currentColor" opacity={0.6}>{translateText(f(lo + span * t, 1, intlLocale))}</text>
        </g>
      ))}
      <text x={pad.l} y={H - 3} fontSize={9} fill="currentColor" opacity={0.6}>{translateText("intervalo 0")}</text>
      <text x={W - pad.r} y={H - 3} textAnchor="end" fontSize={9} fill="currentColor" opacity={0.6}>{translateText(n - 1)}</text>
      {series.map((s, i) => (
        <path key={s.label + i} d={path(s.values)} fill="none" stroke={color} strokeOpacity={0.35 + 0.65 * (1 - i / Math.max(1, series.length))} strokeWidth={1.3}>
          <title>{translateText(s.label)}</title>
        </path>
      ))}
      <path d={path(centroid)} fill="none" stroke="currentColor" strokeWidth={1.8} strokeDasharray="5 3"><title>{translateText("centróide")}</title></path>
    </svg>
  )
}

/** Clustering report stored with the model: per-cluster sizes and errors, closest/farthest series, distances. */
export function ClusteringReportView({ runId, runName }: { runId: string; runName?: string }) {
  const { t: translateText, intlLocale } = useI18n()

  const [data, setData] = useState<ClusteringReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cluster, setCluster] = useState(0)
  const [near, setNear] = useState(5)
  const [far, setFar] = useState(5)
  const [detail, setDetail] = useState<ClusteringReport["cluster"] | null>(null)
  const [generatedAt, setGeneratedAt] = useState(0)

  useEffect(() => {
    let cancelled = false
    getClusteringReport(runId)
      .then((d) => {
        if (cancelled) return
        setData(d)
        setError(null)
        setGeneratedAt(Date.now())
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [runId])

  useEffect(() => {
    if (!data) return
    let cancelled = false
    getClusteringReport(runId, cluster, near, far).then((d) => !cancelled && setDetail(d.cluster ?? null)).catch(() => !cancelled && setDetail(null))
    return () => {
      cancelled = true
    }
  }, [runId, data, cluster, near, far])

  const meta = useMemo(() => ({ source: `SimEDaPE · run ${runId}`, windowLabel: runName ?? "treino", generatedAt, section: "Clusterização" }), [runId, runName, generatedAt])
  if (error) return <p className="text-[11px] text-muted-foreground">{translateText("Relatório de clusterização indisponível: ")}{translateText(error)}</p>
  if (!data) return <p className="text-[11px] text-muted-foreground">{translateText("Carregando relatório…")}</p>

  const r = data.report
  const rows = r.clusters
  const top = r.top
  const current = rows[cluster]
  const hist = current ? current.histogram.counts.map((v, i) => ({ label: f(current.histogram.edges[i + 1]!, 2, intlLocale), value: v })) : []
  const hasDtw = rows.some((c) => c.dtw_distance)
  const hasPca = rows.some((c) => c.pca_unexplained_pct !== undefined)

  return (
    <ExportContext.Provider value={meta}>
      <div data-report-root className="flex flex-col gap-3">
        <ReportDownloads />
        <p className="text-xs font-medium">{translateText("Relatório da clusterização")}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label={translateText("Séries")} value={f(r.n_series, 0, intlLocale)} sub={translateText("{0} intervalos", { 0: r.series_length })} />
          <Stat label={translateText("Clusters")} value={String(r.n_clusters)} sub={translateText("maior: {0} · menor: {1}", { 0: f(Math.max(...rows.map((c) => c.size)), 0, intlLocale), 1: f(Math.min(...rows.map((c) => c.size)), 0, intlLocale) })} />
          <Stat label={translateText("Distância ao centróide")} value={f(r.overall.distance.mean, undefined, intlLocale)} sub={translateText("p90 {0} · máx {1}", { 0: f(r.overall.distance.p90, undefined, intlLocale), 1: f(r.overall.distance.max, undefined, intlLocale) })} />
          <Stat label={translateText("Erro relativo médio")} value={`${f(r.overall.rel_error_pct.mean, 1, intlLocale)}%`} sub={translateText("RMSE médio {0} (unidade original)", { 0: f(r.overall.rmse.mean, undefined, intlLocale) })} />
        </div>

        <Panel
          title={translateText("Resumo por cluster")}
          hint={translateText("Valores absolutos e relativos. Distância: euclidiana (série normalizada ao centróide). RMSE e erro relativo: série original vs centróide desnormalizado, o erro do método base sem DTW.")}
          data={{
            kind: "table",
            columns: ["cluster", "séries", "% das séries", "nível médio", "distância média", "distância p90", "distância máx", "RMSE médio", "erro relativo médio %", "erro relativo p90 %", ...(hasDtw ? ["DTW médio"] : []), ...(hasPca ? ["PCA não explicada %"] : []), "cluster mais próximo"],
            rows: rows.map((c) => [c.cluster, c.size, c.pct, c.mean_level, c.distance.mean, c.distance.p90, c.distance.max, c.rmse.mean, c.rel_error_pct.mean, c.rel_error_pct.p90, ...(hasDtw ? [c.dtw_distance?.mean ?? null] : []), ...(hasPca ? [c.pca_unexplained_pct ?? null] : []), c.nearest_cluster]),
          }}
        >
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-background">
                <tr className="text-left text-muted-foreground">
                  {["Cluster", "Séries", "%", "Nível", "Dist. média", "Dist. p90", "RMSE", "Erro rel.", ...(hasDtw ? ["DTW"] : []), ...(hasPca ? ["PCA n/ expl."] : [])].map((h) => <th key={h} className="whitespace-nowrap py-1 pr-3 text-right first:text-left">{translateText(h)}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.cluster} onClick={() => setCluster(c.cluster)} className={`cursor-pointer border-t border-border hover:bg-muted/50 ${c.cluster === cluster ? "bg-primary/5" : ""}`}>
                    <td className="py-1 pr-3 font-medium">{translateText(c.cluster)}</td>
                    <td className="pr-3 text-right font-mono">{translateText(f(c.size, 0, intlLocale))}</td>
                    <td className="pr-3 text-right font-mono">{translateText(f(c.pct, 1, intlLocale))}%</td>
                    <td className="pr-3 text-right font-mono">{translateText(f(c.mean_level, 1, intlLocale))}</td>
                    <td className="pr-3 text-right font-mono">{translateText(f(c.distance.mean, undefined, intlLocale))}</td>
                    <td className="pr-3 text-right font-mono">{translateText(f(c.distance.p90, undefined, intlLocale))}</td>
                    <td className="pr-3 text-right font-mono">{translateText(f(c.rmse.mean, undefined, intlLocale))}</td>
                    <td className="pr-3 text-right font-mono">{translateText(f(c.rel_error_pct.mean, 1, intlLocale))}%</td>
                    {hasDtw && <td className="pr-3 text-right font-mono">{translateText(f(c.dtw_distance?.mean, undefined, intlLocale))}</td>}
                    {hasPca && <td className="pr-3 text-right font-mono">{c.pca_unexplained_pct === undefined ? translateText("—") : translateText("{0}%", { 0: f(c.pca_unexplained_pct, 1, intlLocale) })}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="grid gap-3 lg:grid-cols-2">
          <Panel title={translateText("Séries por cluster (absoluto)")} data={{ kind: "bars", items: rows.map((c) => ({ label: `cluster ${c.cluster}`, value: c.size })), unit: "séries" }}>
            <BarList items={[...rows].sort((a, b) => b.size - a.size).map((c) => ({ label: `cluster ${c.cluster}`, value: c.size }))} max={15} format={(v) => f(v, 0, intlLocale)} />
          </Panel>
          <Panel title={translateText("Erro relativo médio por cluster (%)")} hint={translateText("Quanto o centróide se afasta das séries do cluster, em relação ao nível delas.")} data={{ kind: "bars", items: rows.map((c) => ({ label: `cluster ${c.cluster}`, value: c.rel_error_pct.mean })), unit: "%" }}>
            <BarList items={[...rows].sort((a, b) => b.rel_error_pct.mean - a.rel_error_pct.mean).map((c) => ({ label: `cluster ${c.cluster}`, value: c.rel_error_pct.mean }))} max={15} format={(v) => `${f(v, 1, intlLocale)}%`} />
          </Panel>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5">{translateText("Cluster")}<select className={sel} value={cluster} onChange={(e) => setCluster(Number(e.target.value))}>
              {rows.map((c) => <option key={c.cluster} value={c.cluster}>{translateText(c.cluster)} ({translateText(f(c.size, 0, intlLocale))}{translateText(" séries)")}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5">{translateText("Mais próximas (X)")}<input className={`${sel} w-16`} type="number" min={0} max={top} value={near} onChange={(e) => setNear(Math.max(0, Math.min(top, Number(e.target.value) || 0)))} />
          </label>
          <label className="flex items-center gap-1.5">{translateText("Mais distantes (Y)")}<input className={`${sel} w-16`} type="number" min={0} max={top} value={far} onChange={(e) => setFar(Math.max(0, Math.min(top, Number(e.target.value) || 0)))} />
          </label>
          <span className="text-[11px] text-muted-foreground">{translateText("Máximo ")}{translateText(top)}{translateText(" de cada; a linha tracejada é o centróide.")}</span>
        </div>

        {detail && (
          <div className="grid gap-3 lg:grid-cols-2">
            {([["near", `${detail.near.length} séries mais próximas do centróide`, detail.near, PALETTE[1]!], ["far", `${detail.far.length} séries mais distantes do centróide`, detail.far, PALETTE[6]!]] as const).map(([key, title, list, color]) => (
              <Panel
                key={key}
                title={translateText("Cluster {0}: {1}", { 0: cluster, 1: title })}
                data={{
                  kind: "table",
                  columns: ["intervalo", "centróide", ...list.map((m, i) => `${m.label ?? `série ${m.index}`} (#${i + 1}, dist ${m.distance.toFixed(3)})`)],
                  plot: "column-lines",
                  rows: detail.centroid.map((c, t) => [t, c, ...list.map((m) => m.series[t] ?? null)]),
                }}
              >
                <SeriesPlot series={list.map((m) => ({ label: `${m.label ?? m.index} · dist ${f(m.distance, 3, intlLocale)}`, values: m.series }))} centroid={detail.centroid} color={color} />
                <ul className="mt-2 max-h-28 overflow-auto text-[10px] text-muted-foreground">
                  {list.map((m) => <li key={m.index} className="flex justify-between gap-2"><span className="truncate">{translateText(m.label ?? `série ${m.index}`)}</span><span className="font-mono">{translateText("dist ")}{translateText(f(m.distance, 3, intlLocale))}{translateText(" · RMSE ")}{translateText(f(m.rmse, undefined, intlLocale))}</span></li>)}
                </ul>
              </Panel>
            ))}
          </div>
        )}

        {current && (
          <Panel title={translateText("Cluster {0}: distribuição das distâncias ao centróide", { 0: cluster })} hint={translateText("Cada barra conta séries com a distância até o limite indicado. Cauda longa = séries mal representadas pelo centróide.")} data={{ kind: "bins", bins: hist, unit: "séries" }}>
            <Distribution bins={hist} quantiles={[{ q: "média", v: current.distance.mean }, { q: "mediana", v: current.distance.median }, { q: "p90", v: current.distance.p90 }, { q: "máx", v: current.distance.max }]} format={(v) => f(v, 3, intlLocale)} />
          </Panel>
        )}

        {r.n_clusters <= 20 && r.n_clusters > 1 && (
          <Panel title={translateText("Distância entre centróides")} hint={translateText("Clusters próximos entre si podem ser candidatos a juntar (menos clusters).")} data={{ kind: "matrix", rows: rows.map((c) => `cluster ${c.cluster}`), cols: rows.map((c) => `cluster ${c.cluster}`), cells: data.centroid_distance, rowLabel: "cluster", colLabel: "cluster", unit: "distância" }}>
            <Matrix rows={rows.map((c) => String(c.cluster))} cols={rows.map((c) => String(c.cluster))} cells={data.centroid_distance} rowLabel={translateText("cluster")} colLabel={translateText("cluster")} format={(v) => f(v, 2, intlLocale)} />
          </Panel>
        )}
      </div>
    </ExportContext.Provider>
  )
}
