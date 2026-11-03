"use client"

import { useI18n } from "@/components/i18n-provider"

import { useEffect, useMemo, useState } from "react"
import { useId } from "react"
import { BarList, Empty, GroupedBars, Panel } from "@/components/metrics/charts"
import { getRunComparisonDetail, type ComparisonDetail, type ComparisonMatrix } from "@/lib/simedape-api"

/** Baselines ignore the partial simulation (they reuse the training weights/normalization), so they reproduce the training base almost exactly: useful as a floor, not as an estimator. */
export const isBaseline = (key: string) => /^(base|pca_d_base)(_|$)/.test(key)
const num = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(d))
const sel = "h-7 rounded-sm border border-input bg-background px-2 text-xs"

const STATS: { key: string; label: string; unit: string; help: string }[] = [
  { key: "wape", label: "WAPE", unit: "%", help: "soma dos erros absolutos ÷ soma do real; não explode perto de zero" },
  { key: "smape", label: "sMAPE", unit: "", help: "erro percentual simétrico (0 a 200)" },
  { key: "median_ape", label: "Mediana |erro|", unit: "%", help: "mediana do erro percentual absoluto; resiste a séries atípicas" },
  { key: "bias_pct", label: "Viés", unit: "%", help: "erro com sinal: positivo = superestima, negativo = subestima" },
  { key: "rmse", label: "RMSE", unit: "", help: "raiz do erro quadrático médio, na unidade da métrica" },
  { key: "mae", label: "MAE", unit: "", help: "erro absoluto médio, na unidade da métrica" },
  { key: "pearson", label: "Correlação", unit: "", help: "Pearson entre real e estimado nas séries (1 = acompanha o real)" },
  { key: "spearman", label: "Correlação de ordem", unit: "", help: "Spearman: a ordem das séries (quem é mais carregada) é preservada?" },
]

/** Robust error measures per method for one metric (WAPE, sMAPE, median |error|, bias, RMSE, MAE, correlations). */
export function RobustPanel({ comparison, methods }: { comparison: ComparisonMatrix; methods: string[] }) {
  const { t: translateText } = useI18n()

  const [metric, setMetric] = useState(comparison.metrics[0]?.key ?? "")
  const robust = comparison.robust?.[metric]
  if (!comparison.robust || !robust) return null
  const label = comparison.metrics.find((k) => k.key === metric)?.label ?? metric
  return (
    <Panel title={translateText("Medidas robustas de erro · {0}", { 0: label })} hint={translateText("Complementam o MAPE, que explode quando o valor real é pequeno. Passe o mouse no cabeçalho para ver o que cada uma mede.")}
      data={{ kind: "table", columns: ["método", ...STATS.map((s) => `${s.label}${s.unit ? ` (${s.unit})` : ""}`)], rows: methods.map((m) => [m, ...STATS.map((s) => robust[s.key]?.[m] ?? null)]) }}>
      <div className="mb-2 flex items-center gap-2 text-xs">
        <label className="flex items-center gap-1.5">{translateText("Métrica")}<select className={sel} value={metric} onChange={(e) => setMetric(e.target.value)}>{comparison.metrics.map((k) => <option key={k.key} value={k.key}>{translateText(k.label)}</option>)}</select>
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-3">{translateText("Método")}</th>{STATS.map((s) => <th key={s.key} className="pr-3 text-right" title={translateText(s.help)}>{translateText(s.label)}</th>)}</tr></thead>
          <tbody>
            {methods.map((m) => (
              <tr key={m} className="border-t border-border"><td className="py-1 pr-3 font-mono">{translateText(m)}</td>
                {STATS.map((s) => <td key={s.key} className="pr-3 text-right font-mono">{translateText(num(robust[s.key]?.[m]))}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

function Scatter({ points }: { points: [number, number][] }) {
  const { t: translateText } = useI18n()

  const W = 360
  const H = 300
  const pad = 40
  if (points.length === 0) return <Empty>{translateText("Sem pontos.")}</Empty>
  const all = points.flat()
  const hi = Math.max(...all, 1e-9)
  const lo = Math.min(0, ...all)
  const pos = (v: number) => pad + ((v - lo) / (hi - lo || 1)) * (W - pad - 10)
  const posY = (v: number) => H - pad - ((v - lo) / (hi - lo || 1)) * (H - pad - 10)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={translateText("Estimado contra real")}>
      <line x1={pos(lo)} y1={posY(lo)} x2={pos(hi)} y2={posY(hi)} stroke="currentColor" strokeDasharray="4 3" opacity={0.4} />
      {points.map(([r, e], i) => <circle key={i} cx={pos(r)} cy={posY(e)} r={2.2} fill="#2563eb" opacity={0.55}><title>{translateText("real {0} · estimado {1}", { 0: num(r, 3), 1: num(e, 3) })}</title></circle>)}
      <text x={W / 2} y={H - 8} textAnchor="middle" fontSize={10} fill="currentColor" opacity={0.7}>{translateText("real")}</text>
      <text x={10} y={H / 2} fontSize={10} fill="currentColor" opacity={0.7} transform={`rotate(-90 10 ${H / 2})`} textAnchor="middle">{translateText("estimado")}</text>
      <text x={pad - 4} y={H - pad + 12} fontSize={9} textAnchor="end" fill="currentColor" opacity={0.6}>{translateText(num(lo, 1))}</text>
      <text x={W - 10} y={H - pad + 12} fontSize={9} textAnchor="end" fill="currentColor" opacity={0.6}>{translateText(num(hi, 1))}</text>
      <text x={pad - 4} y={14} fontSize={9} textAnchor="end" fill="currentColor" opacity={0.6}>{translateText(num(hi, 1))}</text>
    </svg>
  )
}

const BREAKDOWNS: { key: string; title: string }[] = [
  { key: "by_cluster", title: "por cluster" },
  { key: "by_interval", title: "por intervalo de tempo" },
  { key: "by_length", title: "por classe de comprimento da via" },
]

/** Results of one method in detail: network summary, estimated × real, worst series and the error by cluster / interval / link length. */
export function SpecificPanel({ runId, comparison, defaultMethod }: { runId: string; comparison: ComparisonMatrix; defaultMethod: string }) {
  const { t: translateText } = useI18n()

  const [method, setMethod] = useState(defaultMethod)
  const [metric, setMetric] = useState(comparison.metrics[0]?.key ?? "")
  const [detail, setDetail] = useState<ComparisonDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!method) return
    let cancelled = false
    getRunComparisonDetail(runId, method).then((d) => { if (!cancelled) { setDetail(d); setError(null) } }).catch((e) => !cancelled && (setDetail(null), setError((e as Error).message)))
    return () => {
      cancelled = true
    }
  }, [runId, method])
  const label = comparison.metrics.find((k) => k.key === metric)?.label ?? metric
  const sp = detail?.specific
  const metricsHere = useMemo(() => comparison.metrics.filter((k) => detail?.aggregate.real[k.key] !== undefined), [comparison, detail])
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <p className="text-xs font-medium">{translateText("Resultado detalhado")}</p>
        <label className="flex items-center gap-1.5">{translateText("Variação")}<select className={sel} value={method} onChange={(e) => setMethod(e.target.value)}>{comparison.methods.map((m) => <option key={m} value={m}>{translateText(m)}</option>)}</select>
        </label>
        <label className="flex items-center gap-1.5">{translateText("Métrica")}<select className={sel} value={metric} onChange={(e) => setMetric(e.target.value)}>{comparison.metrics.map((k) => <option key={k.key} value={k.key}>{translateText(k.label)}</option>)}</select>
        </label>
      </div>
      {error && <p className="text-[11px] text-muted-foreground">{translateText("Detalhe indisponível: ")}{translateText(error)}</p>}
      {detail && (
        <>
          <Panel title={translateText("Visão geral da rede · {0}", { 0: method })} hint={translateText("Médias geométricas sobre as {0} séries comparadas ({1}). Cobertura {2}%.", { 0: detail.n_paired, 1: detail.pairing === "label" ? translateText("pareadas por rótulo") : translateText("pareadas por posição: resultado antigo, sem rótulos"), 2: num(detail.coverage_pct, 1) })}
            data={{ kind: "table", columns: ["métrica", "real", "estimado", "erro %"], rows: metricsHere.map((k) => [k.label, detail.aggregate.real[k.key] ?? null, detail.aggregate.estimated[k.key] ?? null, detail.aggregate.error_pct[k.key] ?? null]) }}>
            <table className="w-full text-[11px]">
              <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-3">{translateText("Métrica")}</th><th className="pr-3 text-right">{translateText("Real")}</th><th className="pr-3 text-right">{translateText("Estimado")}</th><th className="text-right">{translateText("Erro")}</th></tr></thead>
              <tbody>
                {metricsHere.map((k) => (
                  <tr key={k.key} className="border-t border-border"><td className="py-1 pr-3 font-medium">{translateText(k.label)}</td><td className="pr-3 text-right font-mono">{translateText(num(detail.aggregate.real[k.key], 3))}</td><td className="pr-3 text-right font-mono">{translateText(num(detail.aggregate.estimated[k.key], 3))}</td><td className="text-right font-mono">{translateText(num(detail.aggregate.error_pct[k.key], 1))}%</td></tr>
                ))}
              </tbody>
            </table>
          </Panel>
          {!sp ? (
            <Empty>{translateText("Este resultado é antigo (sem rótulos das séries): refaça a estimativa para ver o detalhe por série.")}</Empty>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              <Panel title={translateText("Estimado × real · {0}", { 0: label })} hint={translateText("Cada ponto é uma série (via e intervalo). Na diagonal, a estimativa acertou.")} data={{ kind: "table", columns: ["real", "estimado"], rows: sp.scatter[metric] ?? [] }}>
                <Scatter points={sp.scatter[metric] ?? []} />
              </Panel>
              <Panel title={translateText("Piores séries · {0}", { 0: label })} hint={translateText("Maiores erros percentuais absolutos.")}
                data={{ kind: "table", columns: ["série", "real", "estimado", "erro %"], rows: (sp.worst[metric] ?? []).map((w) => [w.label, w.real, w.estimated, w.error_pct]) }}>
                <div className="max-h-72 overflow-auto">
                  <table className="w-full text-[11px]">
                    <thead className="sticky top-0 bg-background"><tr className="text-left text-muted-foreground"><th className="py-1 pr-3">{translateText("Série")}</th><th className="pr-3 text-right">{translateText("Real")}</th><th className="pr-3 text-right">{translateText("Estimado")}</th><th className="text-right">{translateText("Erro")}</th></tr></thead>
                    <tbody>
                      {(sp.worst[metric] ?? []).map((w) => (
                        <tr key={w.label} className="border-t border-border"><td className="py-1 pr-3 font-mono">{translateText(w.label)}</td><td className="pr-3 text-right font-mono">{translateText(num(w.real, 3))}</td><td className="pr-3 text-right font-mono">{translateText(num(w.estimated, 3))}</td><td className="text-right font-mono">{translateText(num(w.error_pct, 1))}%</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
              {BREAKDOWNS.map((b) => {
                const rows = Object.entries(sp.breakdowns[metric]?.[b.key] ?? {})
                if (rows.length === 0) return null
                const sorted = rows.sort((a, c) => (c[1].wape ?? 0) - (a[1].wape ?? 0))
                return (
                  <Panel key={b.key} title={translateText("Erro {0} · {1}", { 0: b.title, 1: label })} hint={translateText("WAPE (%) de cada grupo; o viés (superestima +, subestima −) está na tabela exportada.")}
                    data={{ kind: "table", columns: ["grupo", "séries", "WAPE %", "viés %", "mediana |erro| %"], rows: sorted.map(([k, v]) => [k, v.n, v.wape, v.bias_pct, v.median_ape]) }}>
                    <BarList items={sorted.map(([k, v]) => ({ label: `${k} (${v.n})`, value: v.wape ?? 0 }))} max={12} format={(v) => `${v.toFixed(1)}%`} />
                  </Panel>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}


/** Error by method and metric. A few methods x few metrics stay as grouped bars (readable); beyond that a grouped bar chart turns into
 *  noise, so it becomes a heat table (each metric coloured against its own range) plus bars for ONE chosen metric, best first. */
export function ErrorChart({ title, hint, unit, metrics, methods, value, detailsHint, signed }: {
  title: string
  hint?: string
  unit: string
  metrics: { key: string; label: string }[]
  methods: string[]
  value: (metric: string, method: string) => number | null | undefined
  detailsHint?: string
  /** The values carry a sign (over/under-estimation): colour and rank by magnitude, show the sign. */
  signed?: boolean
}) {
  const { t: translateText } = useI18n()

  const [metric, setMetric] = useState(metrics[0]?.key ?? "")
  const id = useId()
  const grouped = metrics.length * methods.length <= 24 && methods.length <= 8
  const exportData = { kind: "table" as const, columns: ["método", ...metrics.map((k) => `${k.label} (${unit})`)], rows: methods.map((m) => [m, ...metrics.map((k) => value(k.key, m) ?? null)]) }
  if (grouped) {
    return (
      <Panel title={translateText(title)} hint={translateText(hint)} data={exportData}>
        <GroupedBars categories={metrics.map((k) => k.label)} series={methods.map((m) => ({ label: m, values: metrics.map((k) => value(k.key, m) ?? null) }))} format={(v) => v.toFixed(1)} />
      </Panel>
    )
  }
  const range = Object.fromEntries(metrics.map((k) => {
    const vals = methods.map((m) => value(k.key, m)).filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v)).map((v) => (signed ? Math.abs(v) : v))
    return [k.key, { lo: Math.min(...vals), hi: Math.max(...vals) }]
  }))
  const chosen = methods.map((m) => ({ label: m, value: value(metric, m) })).filter((x): x is { label: string; value: number } => x.value !== null && x.value !== undefined && Number.isFinite(x.value)).map((x) => ({ label: signed ? `${x.label} (${x.value >= 0 ? "+" : "−"})` : x.label, value: signed ? Math.abs(x.value) : x.value })).sort((a, b) => a.value - b.value)
  return (
    <Panel title={translateText(title)} hint={translateText(`${hint ?? ""} Com muitas métricas ou métodos, a tabela colore cada métrica pela própria faixa (verde = menor erro) e as barras mostram uma métrica por vez.`.trim())} data={exportData}>
      <div className="flex flex-col gap-3">
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-background"><tr className="text-left text-muted-foreground"><th className="py-1 pr-3">{translateText("Método")}</th>{metrics.map((k) => <th key={k.key} className="px-1 text-right font-normal" title={translateText(k.label)}>{translateText(k.label.replace(/\s*\(.*\)$/, ""))}</th>)}</tr></thead>
            <tbody>
              {methods.map((m) => (
                <tr key={m} className="border-t border-border">
                  <td className="py-1 pr-3 font-mono">{translateText(m)}</td>
                  {metrics.map((k) => {
                    const v = value(k.key, m)
                    const r = range[k.key]!
                    const mag = v === null || v === undefined ? v : signed ? Math.abs(v) : v
                    const t = mag === null || mag === undefined || !Number.isFinite(mag) || r.hi === r.lo ? 0 : (mag - r.lo) / (r.hi - r.lo)
                    return <td key={k.key} className="px-1 text-right font-mono" style={{ background: v === null || v === undefined ? undefined : `color-mix(in srgb, ${t < 0.34 ? "#16a34a" : t < 0.67 ? "#d97706" : "#dc2626"} ${Math.round(10 + t * 40)}%, transparent)` }}>{translateText(num(v, 1))}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-1.5 text-xs" htmlFor={id}>{translateText("Barras da métrica")}<select id={id} className={sel} value={metric} onChange={(e) => setMetric(e.target.value)}>{metrics.map((k) => <option key={k.key} value={k.key}>{translateText(k.label)}</option>)}</select>
            <span className="text-[11px] text-muted-foreground">{translateText(detailsHint ?? (signed ? "em módulo; (+) superestima, (−) subestima; melhor primeiro" : "menor é melhor; melhor primeiro"))}</span>
          </label>
          <BarList items={chosen} max={24} format={(v) => `${v.toFixed(1)}${unit === "%" ? "%" : ""}`} />
        </div>
      </div>
    </Panel>
  )
}
