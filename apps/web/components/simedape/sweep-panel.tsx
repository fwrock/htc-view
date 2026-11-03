"use client"

import { useI18n } from "@/components/i18n-provider"

import { useEffect, useMemo, useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { Empty, ExportContext, PALETTE, Panel, Stat } from "@/components/metrics/charts"
import { VariantPicker } from "@/components/simedape/variant-picker"
import { getRunSweep, type SweepTable } from "@/lib/simedape-api"

const input = "h-8 w-full rounded-sm border border-input bg-background px-2 text-xs focus:border-ring focus:ring-1 focus:ring-ring/30 focus:outline-none"
type Row = { label: string; dir: string; percentage: string }
const num = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(d))

/** Inputs of a sweep: the partial simulations to compare (already run) and the estimation variations to apply to each. */
export function SweepPanel({ scenarios, onScenarios, variants, onVariants, defaultPartial, isClickhouse, simulations, available }: {
  scenarios: Row[]
  onScenarios: (rows: Row[]) => void
  variants: string[]
  onVariants: (keys: string[]) => void
  defaultPartial: string
  isClickhouse: boolean
  simulations: string[]
  available: { dtw: boolean; pca: boolean }
}) {
  const { t: translateText } = useI18n()

  const set = (i: number, patch: Partial<Row>) => onScenarios(scenarios.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">{translateText("Compara como o erro cai à medida que a parcial traz mais dados. Cada linha é uma simulação ")}<b>{translateText("parcial já executada")}</b>{translateText(" (por exemplo com 5%, 10%, 25% e 50% das unidades); para cada uma, a varredura roda as variações escolhidas e compara com a simulação completa. Gere as parciais no passo Parcial, variando o percentual da seleção.")}</p>
      <div className="flex flex-col gap-2 rounded-sm border border-border p-3">
        <p className="text-xs font-medium">{translateText("Parciais a comparar")}</p>
        <datalist id="sweep-sims">{simulations.map((s) => <option key={s} value={s} />)}</datalist>
        {scenarios.length === 0 && <p className="text-[11px] text-muted-foreground">{translateText("Nenhuma ainda. Adicione abaixo.")}</p>}
        {scenarios.map((r, i) => (
          <div key={i} className="grid items-center gap-2 sm:grid-cols-[8rem_1fr_7rem_auto]">
            <input className={input} placeholder={translateText("rótulo (ex.: 10%)")} value={r.label} onChange={(e) => set(i, { label: e.target.value })} />
            <input className={cn(input, "font-mono")} list={isClickhouse ? "sweep-sims" : undefined} placeholder={isClickhouse ? translateText("simulation_id da parcial") : translateText("/pasta/da/parcial/")} value={r.dir} onChange={(e) => set(i, { dir: e.target.value })} />
            <label className="flex items-center gap-1 text-[11px]"><input type="number" min={0} max={100} className={cn(input, "font-mono")} placeholder={translateText("%")} value={r.percentage} onChange={(e) => set(i, { percentage: e.target.value })} />%</label>
            <button type="button" className="rounded-sm p-1 text-destructive hover:bg-muted" aria-label={translateText("Remover parcial")} onClick={() => onScenarios(scenarios.filter((_, j) => j !== i))}><Trash2 className="size-3.5" /></button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" type="button" onClick={() => onScenarios([...scenarios, { label: "", dir: "", percentage: "" }])}><Plus className="size-3.5" />{translateText(" Parcial")}</Button>
          {defaultPartial.trim() && !scenarios.some((r) => r.dir === defaultPartial) && (
            <Button size="sm" variant="outline" type="button" onClick={() => onScenarios([...scenarios, { label: "", dir: defaultPartial, percentage: "" }])}>{translateText("Usar a parcial do passo 4")}</Button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">{translateText("O percentual é o da amostra (usado pelas variações ")}<span className="font-mono">{translateText("wavg")}</span>{translateText(") e o eixo do gráfico. O rótulo é opcional.")}</p>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium">{translateText("Variações")}</p>
        <VariantPicker value={variants} onChange={onVariants} available={available} />
      </div>
    </div>
  )
}

function Lines({ table, methods, metric, kind, dashedFrom }: { table: SweepTable; methods: string[]; metric: string; kind: "mape" | "error_pct"; dashedFrom?: number }) {
  const { t: translateText } = useI18n()

  const W = 640
  const H = 220
  const pad = { l: 46, r: 12, t: 8, b: 26 }
  const xs = table.scenarios.map((s, i) => s.percentage ?? i)
  const data = methods.map((m) => (table[kind][metric]?.[m] ?? []).map((v) => (v === null || v === undefined || !Number.isFinite(v) ? null : v)))
  const vals = data.flat().filter((v): v is number => v !== null)
  if (vals.length === 0 || xs.length === 0) return <Empty>{translateText("Sem dados.")}</Empty>
  const hi = Math.max(...vals, 1e-9)
  const lo = 0
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const x = (v: number) => pad.l + (x1 === x0 ? 0.5 : (v - x0) / (x1 - x0)) * (W - pad.l - pad.r)
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b)
  return (
    <div className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={translateText("Erro por percentual da parcial")}>
        {[0, 0.5, 1].map((t) => (
          <g key={t}><line x1={pad.l} x2={W - pad.r} y1={y(lo + (hi - lo) * t)} y2={y(lo + (hi - lo) * t)} stroke="currentColor" opacity={0.12} />
            <text x={pad.l - 4} y={y(lo + (hi - lo) * t) + 3} textAnchor="end" fontSize={9} fill="currentColor" opacity={0.6}>{translateText(num(lo + (hi - lo) * t))}</text></g>
        ))}
        {xs.map((v, i) => <text key={i} x={x(v)} y={H - 8} textAnchor="middle" fontSize={9} fill="currentColor" opacity={0.7}>{translateText(table.scenarios[i]!.label)}</text>)}
        {data.map((row, k) => {
          const pts = row.map((v, i) => (v === null ? null : [x(xs[i]!), y(v)] as const))
          const path = pts.filter(Boolean).map((p, i) => `${i ? "L" : "M"}${p![0].toFixed(1)},${p![1].toFixed(1)}`).join(" ")
          return (
            <g key={methods[k]}>
              <path d={path} fill="none" stroke={PALETTE[k % PALETTE.length]} strokeWidth={1.6} strokeDasharray={dashedFrom !== undefined && k >= dashedFrom ? "5 3" : undefined}><title>{translateText(methods[k])}</title></path>
              {pts.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r={2.5} fill={PALETTE[k % PALETTE.length]}><title>{translateText("{0} @ {1}: {2}", { 0: methods[k], 1: table.scenarios[i]!.label, 2: num(row[i]) })}</title></circle>)}
            </g>
          )
        })}
      </svg>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
        {methods.map((m, k) => <li key={m} className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: PALETTE[k % PALETTE.length], opacity: dashedFrom !== undefined && k >= dashedFrom ? 0.6 : 1 }} />{translateText(m)}{dashedFrom !== undefined && k >= dashedFrom ? translateText(" (pior)") : translateText("")}</li>)}
      </ul>
    </div>
  )
}

/** Result of a sweep run: error vs sample percentage per variation, ranking and coverage. */
export function SweepResults({ runId }: { runId: string }) {
  const { t: translateText } = useI18n()

  const [table, setTable] = useState<SweepTable | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [metric, setMetric] = useState("")
  const [kind, setKind] = useState<"mape" | "error_pct">("mape")
  const [showAll, setShowAll] = useState(false)
  useEffect(() => {
    let cancelled = false
    getRunSweep(runId).then((t) => { if (!cancelled) { setTable(t); setMetric((m) => m || t.metrics[0]?.key || "") } }).catch((e) => !cancelled && setError((e as Error).message))
    return () => {
      cancelled = true
    }
  }, [runId])
  const ranked = useMemo(() => {
    if (!table || !metric) return []
    return table.methods.map((m) => {
      const vals = (table[kind][metric]?.[m] ?? []).filter((v): v is number => v !== null && Number.isFinite(v))
      return { m, mean: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null }
    }).filter((x): x is { m: string; mean: number } => x.mean !== null).sort((a, b) => a.mean - b.mean)
  }, [table, metric, kind])
  const meta = useMemo(() => ({ source: `SimEDaPE · run ${runId}`, windowLabel: "varredura", generatedAt: Date.now(), section: "Varredura" }), [runId])
  if (error) return <p className="text-[11px] text-muted-foreground">{translateText("Resultados da varredura indisponíveis: ")}{translateText(error)}</p>
  if (!table) return <p className="text-[11px] text-muted-foreground">{translateText("Carregando resultados…")}</p>
  const EXTREMES = 10
  const shown = showAll || ranked.length <= 2 * EXTREMES ? ranked.map((r) => r.m) : [...ranked.slice(0, EXTREMES), ...ranked.slice(-EXTREMES)].map((r) => r.m)
  const metricLabel = table.metrics.find((k) => k.key === metric)?.label ?? metric
  const unit = kind === "mape" ? "MAPE %" : "erro agregado %"
  return (
    <ExportContext.Provider value={meta}>
      <div className="flex flex-col gap-3">
        <p className="text-xs font-medium">{translateText("Resultado da varredura")}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label={translateText("Parciais")} value={String(table.scenarios.length)} sub={translateText(table.scenarios.map((s) => s.label).join(" · "))} />
          <Stat label={translateText("Variações")} value={String(table.methods.length)} />
          <Stat label={translateText("Melhor (média das parciais)")} value={ranked[0]?.m ?? "—"} sub={ranked[0] ? translateText("{0}% em {1}", { 0: num(ranked[0].mean), 1: metricLabel }) : undefined} />
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5">{translateText("Métrica")}<select className="h-7 rounded-sm border border-input bg-background px-2 text-xs" value={metric} onChange={(e) => setMetric(e.target.value)}>{table.metrics.map((k) => <option key={k.key} value={k.key}>{translateText(k.label)}</option>)}</select>
          </label>
          <label className="flex items-center gap-1.5">{translateText("Erro")}<select className="h-7 rounded-sm border border-input bg-background px-2 text-xs" value={kind} onChange={(e) => setKind(e.target.value as "mape" | "error_pct")}><option value="mape">{translateText("MAPE por série")}</option><option value="error_pct">{translateText("agregado")}</option></select>
          </label>
          {ranked.length > 2 * EXTREMES && <button type="button" className="text-[11px] underline" onClick={() => setShowAll((v) => !v)}>{showAll ? translateText("só as {0} melhores e {1} piores", { 0: EXTREMES, 1: EXTREMES }) : translateText("todas as {0}", { 0: ranked.length })}</button>}
        </div>
        <Panel title={translateText("Erro × percentual da parcial · {0}", { 0: metricLabel })} hint={translateText("Menor é melhor. Cada linha é uma variação; o eixo é o percentual da amostra de cada parcial.{0}", { 0: !showAll && ranked.length > 2 * EXTREMES ? translateText(" Linhas cheias: as {0} melhores; tracejadas: as {1} piores.", { 0: EXTREMES, 1: EXTREMES }) : "" })}
          data={{ kind: "table", columns: ["variação", ...table.scenarios.map((s) => `${s.label} (${unit})`)], rows: ranked.map((r) => [r.m, ...(table[kind][metric]?.[r.m] ?? [])]) }}>
          <Lines table={table} methods={shown} metric={metric} kind={kind} dashedFrom={!showAll && ranked.length > 2 * EXTREMES ? EXTREMES : undefined} />
        </Panel>
        <Panel title={translateText("Ranking e cobertura")} hint={translateText("Ordenado pelo erro médio entre as parciais. Cobertura = % das séries estimadas.")}
          data={{ kind: "table", columns: ["posição", "variação", `erro médio (${unit})`, ...table.scenarios.map((s) => `cobertura ${s.label} %`)], rows: ranked.map((r, i) => [i + 1, r.m, r.mean, ...(table.coverage_pct[r.m] ?? [])]) }}>
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-background"><tr className="text-left text-muted-foreground"><th className="py-1 pr-3">#</th><th className="pr-3">{translateText("Variação")}</th>{table.scenarios.map((s) => <th key={s.label} className="pr-3 text-right">{translateText(s.label)}</th>)}<th className="text-right">{translateText("Média")}</th></tr></thead>
              <tbody>
                {ranked.map((r, i) => (
                  <tr key={r.m} className="border-t border-border"><td className="py-1 pr-3 font-mono">{translateText(i + 1)}</td><td className="pr-3 font-mono">{translateText(r.m)}</td>
                    {(table[kind][metric]?.[r.m] ?? []).map((v, j) => <td key={j} className="pr-3 text-right font-mono">{translateText(num(v))}</td>)}
                    <td className="text-right font-mono font-medium">{translateText(num(r.mean))}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </ExportContext.Provider>
  )
}
