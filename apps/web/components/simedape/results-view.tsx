"use client"

import { useI18n } from "@/components/i18n-provider"

import { useEffect, useMemo, useState } from "react"
import { FileText, Loader2, Package, Sigma } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { BarList, Empty, ExportContext, GroupedBars, Panel, Stat } from "@/components/metrics/charts"
import { ErrorChart, isBaseline, RobustPanel, SpecificPanel } from "@/components/simedape/estimate-details"
import { type ExportMeta } from "@/lib/metrics-export"
import {
  reportUrl,
  getRunComparison,
  getRunEstimation,
  type ComparisonMatrix,
  type EstimationOverview,
} from "@/lib/simedape-api"

const METHOD_HELP: Record<string, string> = {
  avg: "ponto de simulação alinhado pelo warping path, normalização média da base e da parcial",
  sample: "alinhado pelo warping path, só com a normalização da parcial",
  wavg: "como avg, com a parcial ponderada pelo percentual da amostra",
  base: "linha de base: só com a normalização da base completa, ignora a parcial",
}
const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(d) + "%")
const num = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(d))

/** Loads a run's estimation and comparison and shows them (see ResultsBody). */
export function ResultsView({ runId, runName }: { runId: string; runName?: string }) {
  const { t: translateText } = useI18n()

  const [estimation, setEstimation] = useState<EstimationOverview | null>(null)
  const [comparison, setComparison] = useState<ComparisonMatrix | null>(null)
  const [loading, setLoading] = useState(true)
  const [generatedAt, setGeneratedAt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.allSettled([getRunEstimation(runId), getRunComparison(runId)]).then(([est, cmp]) => {
      if (cancelled) return
      setEstimation(est.status === "fulfilled" ? est.value : null)
      setComparison(cmp.status === "fulfilled" ? cmp.value : null)
      setGeneratedAt(Date.now())
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [runId])

  if (loading) return <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />{translateText(" Carregando resultados…")}</p>
  return <ResultsBody runId={runId} runName={runName} estimation={estimation} comparison={comparison} generatedAt={generatedAt} />
}

/** Estimation and comparison as charts and tables, every panel exportable (CSV, JSON, PNG, JPEG, SVG) plus a PDF report. */
export function ResultsBody({
  runId,
  runName,
  estimation,
  comparison,
  generatedAt,
}: {
  runId: string
  runName?: string
  estimation: EstimationOverview | null
  comparison: ComparisonMatrix | null
  generatedAt: number
}) {
  const { t: translateText } = useI18n()


  const meta: ExportMeta = useMemo(
    () => ({ source: `SimEDaPE · run ${runId}`, windowLabel: runName ?? "estimação e comparação", generatedAt, section: "Resultados" }),
    [runId, runName, generatedAt]
  )

  const allMethods = comparison?.methods ?? []
  const [showAll, setShowAll] = useState(false)
  // how the exported PDF / LaTeX write the variations and in which language (the screen itself keeps the code keys)
  const [names, setNames] = useState<"short" | "long" | "key">("short")
  const [lang, setLang] = useState<"pt" | "en">("pt")
  const exportParams = { names, lang }
  const metrics = comparison?.metrics ?? []
  const best = useMemo(() => {
    if (!comparison) return null
    const means = comparison.methods.map((m) => {
      const vals = comparison.metrics.map((k) => comparison.mape[k.key]?.[m]).filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v))
      return { m, mean: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null }
    }).filter((x): x is { m: string; mean: number } => x.mean !== null)
    return means.sort((a, b) => a.mean - b.mean)
  }, [comparison])
  // with many variations the charts would be unreadable: show the best ones unless asked for all
  const EXTREMES = 10
  const crowded = allMethods.length > 2 * EXTREMES
  const methods = useMemo(() => {
    if (!crowded || showAll) return allMethods
    const order = (best ?? []).map((b) => b.m)
    const ranked = [...allMethods].sort((a, b) => (order.indexOf(a) + 1 || 9999) - (order.indexOf(b) + 1 || 9999))
    return [...ranked.slice(0, EXTREMES), ...ranked.slice(-EXTREMES)]
  }, [allMethods, best, crowded, showAll])

  const estMethods = Object.entries(estimation?.methods ?? {})
  if (estMethods.length === 0 && allMethods.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">{translateText("Esta execução não gerou resultados de estimação ou comparação. Rode a etapa ")}<b>{translateText("Estimar")}</b>{translateText(" (estágios ")}<code className="font-mono">estimation</code>{translateText(" e ")}<code className="font-mono">compare</code>).
      </p>
    )
  }

  return (
    <ExportContext.Provider value={meta}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[11px] text-muted-foreground">{translateText("Cada painel tem o menu Exportar (imagem, CSV, JSON, LaTeX). Os botões ao lado geram, em Python, o PDF vetorial, as tabelas LaTeX e o pacote para artigo.")}</p>
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-[11px]" title={translateText("Como as variações são escritas nos arquivos exportados")}>{translateText("Nomes")}<select className="h-8 rounded-sm border border-input bg-background px-1.5 text-xs" value={names} onChange={(e) => setNames(e.target.value as "short" | "long" | "key")}>
                <option value="short">{translateText("notação curta (artigo)")}</option><option value="long">{translateText("descrição")}</option><option value="key">{translateText("chave")}</option>
              </select>
            </label>
            <label className="flex items-center gap-1 text-[11px]">{translateText("Idioma")}<select className="h-8 rounded-sm border border-input bg-background px-1.5 text-xs" value={lang} onChange={(e) => setLang(e.target.value as "pt" | "en")}><option value="pt">{translateText("PT")}</option><option value="en">{translateText("EN")}</option></select>
            </label>
            <a className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-border px-3 text-xs hover:bg-muted" href={reportUrl(runId, "pdf", exportParams)} title={translateText("PDF vetorial gerado em Python (matplotlib): figuras e tabelas")}>
              <FileText className="size-3.5" />{translateText(" PDF vetorial")}</a>
            <a className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-border px-3 text-xs hover:bg-muted" href={reportUrl(runId, "latex", exportParams)} title={translateText("Todas as tabelas em LaTeX (booktabs)")}>
              <Sigma className="size-3.5" />{translateText(" Tabelas LaTeX")}</a>
            <a className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-border px-3 text-xs hover:bg-muted" href={reportUrl(runId, "zip", exportParams)} title={translateText("report.pdf, figuras em PDF vetorial, tabelas .tex e um main.tex de exemplo")}>
              <Package className="size-3.5" />{translateText(" Pacote para artigo (.zip)")}</a>
          </span>
        </div>

        <div className="flex flex-col gap-3">
          {best && best.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {(() => {
                const real = best.filter((b) => !isBaseline(b.m))
                const top = real[0] ?? best[0]!
                return (
                  <>
                    <Stat label={translateText("Melhor método (que usa a parcial)")} value={top.m} sub={translateText("MAPE médio {0}", { 0: pct(top.mean) })} />
                    {real.slice(1, 4).map((b) => <Stat key={b.m} label={translateText(b.m)} value={pct(b.mean)} sub={translateText("MAPE médio")} />)}
                  </>
                )
              })()}
            </div>
          )}

          {crowded && best && (
            <Panel title={translateText("Ranking das {0} variações", { 0: best.length })} hint={translateText("Ordenadas pelo MAPE médio das métricas (menor é melhor). As marcadas como base ignoram a parcial: são o piso de comparação, não um estimador.")}
              data={{ kind: "table", columns: ["posição", "variação", "MAPE médio %", "cobertura %"], rows: best.map((b, i) => [i + 1, b.m, b.mean, comparison!.coverage_pct[b.m] ?? null]) }}>
              <div className="mb-2 flex items-center gap-3 text-[11px]">
                <span>{translateText("Os gráficos abaixo mostram ")}{showAll ? translateText("todas") : translateText("as {0} melhores e as {1} piores", { 0: EXTREMES, 1: EXTREMES })}.</span>
                <button type="button" className="underline" onClick={() => setShowAll((v) => !v)}>{showAll ? translateText("só as {0} melhores e {1} piores", { 0: EXTREMES, 1: EXTREMES }) : translateText("mostrar todas")}</button>
              </div>
              <div className="max-h-72 overflow-auto">
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0 bg-background"><tr className="text-left text-muted-foreground"><th className="py-1 pr-3">#</th><th className="pr-3">{translateText("Variação")}</th><th className="pr-3 text-right">{translateText("MAPE médio")}</th><th className="text-right">{translateText("Cobertura")}</th></tr></thead>
                  <tbody>
                    {best.map((b, i) => (
                      <tr key={b.m} className="border-t border-border"><td className="py-1 pr-3 font-mono">{translateText(i + 1)}</td><td className="pr-3 font-mono">{translateText(b.m)}{isBaseline(b.m) && <span className="ml-1.5 rounded-sm bg-muted px-1 font-sans text-[9px] uppercase text-muted-foreground" title={translateText("Linha de base: ignora a parcial e reproduz a base de treino")}>{translateText("base")}</span>}</td><td className="pr-3 text-right font-mono">{translateText(pct(b.mean))}</td><td className="text-right font-mono">{translateText(pct(comparison!.coverage_pct[b.m]))}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
          {methods.length > 0 && (
            <div className="grid gap-3 lg:grid-cols-2">
              <ErrorChart title={translateText("Erro por métrica e método (MAPE %)")} hint={translateText("Menor é melhor. Comparação com a simulação completa (100%).")} unit="%" metrics={metrics} methods={methods} value={(k, m) => comparison!.mape[k]?.[m]} />
              <ErrorChart title={translateText("Erro agregado por métrica e método (%)")} hint={translateText("Média geométrica do erro das séries; o sinal indica superestimar (+) ou subestimar (−).")} unit="%" signed metrics={metrics} methods={methods} value={(k, m) => comparison!.aggregate_error_pct[k]?.[m]} />
              <Panel title={translateText("Cobertura por método (%)")} hint={translateText("Fração das séries reais que o método conseguiu estimar.")}
                data={{ kind: "bars", items: methods.map((m) => ({ label: m, value: comparison!.coverage_pct[m] ?? 0 })), unit: "%" }}>
                {methods.length > 8 ? <BarList items={[...methods].sort((a, b) => (comparison!.coverage_pct[b] ?? 0) - (comparison!.coverage_pct[a] ?? 0)).map((m) => ({ label: m, value: comparison!.coverage_pct[m] ?? 0 }))} max={24} format={(v) => `${v.toFixed(0)}%`} /> : <GroupedBars categories={methods} series={[{ label: "cobertura", values: methods.map((m) => comparison!.coverage_pct[m] ?? null) }]} format={(v) => v.toFixed(0)} />}
              </Panel>
              <Panel title={translateText("Tabela de MAPE (%)")} data={{ kind: "table", columns: ["métrica", ...methods], rows: metrics.map((k) => [k.label, ...methods.map((m) => comparison!.mape[k.key]?.[m] ?? null)]) }}>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-3">{translateText("Métrica")}</th>{methods.map((m) => <th key={m} className="pr-3 text-right">{translateText(m)}</th>)}</tr></thead>
                    <tbody>
                      {metrics.map((k) => (
                        <tr key={k.key} className="border-t border-border">
                          <td className="py-1 pr-3 font-medium">{translateText(k.label)}</td>
                          {methods.map((m) => {
                            const v = comparison!.mape[k.key]?.[m]
                            const lowest = methods.every((o) => (comparison!.mape[k.key]?.[o] ?? Infinity) >= (v ?? Infinity))
                            return <td key={m} className={cn("pr-3 text-right font-mono", lowest && v !== null && "font-semibold text-green-600 dark:text-green-400")}>{translateText(num(v))}</td>
                          })}
                        </tr>
                      ))}
                      <tr className="border-t border-border text-muted-foreground"><td className="py-1 pr-3">{translateText("Séries reais / estimadas")}</td>{methods.map((m) => <td key={m} className="pr-3 text-right font-mono">{translateText(comparison!.n_real[m] ?? "—")} / {translateText(comparison!.n_estimated[m] ?? "—")}</td>)}</tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-muted-foreground">{translateText("Em verde, o menor erro de cada métrica.")}</p>
              </Panel>
            </div>
          )}

          {comparison && methods.length > 0 && <RobustPanel comparison={comparison} methods={methods} />}
          {comparison && allMethods.length > 0 && <SpecificPanel runId={runId} comparison={comparison} defaultMethod={best?.find((b) => !isBaseline(b.m))?.m ?? best?.[0]?.m ?? allMethods[0]!} />}

          {estMethods.length > 0 && (
            <div className="grid gap-3 lg:grid-cols-2">
              {estMethods.filter(([m]) => !crowded || showAll || methods.includes(m)).map(([method, info]) => {
                const rows = Object.entries(info.metrics)
                return (
                  <Panel key={method} title={translateText("Estimação: {0}", { 0: method })} hint={translateText(METHOD_HELP[method])}
                    data={{ kind: "table", columns: ["métrica", "séries", "mín", "média", "máx"], rows: rows.map(([k, st]) => [k, st.count, st.min, st.mean, st.max]) }}>
                    <table className="w-full text-[11px]">
                      <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-3">{translateText("Métrica")}</th><th className="pr-3 text-right">{translateText("Séries")}</th><th className="pr-3 text-right">{translateText("Mín")}</th><th className="pr-3 text-right">{translateText("Média")}</th><th className="text-right">{translateText("Máx")}</th></tr></thead>
                      <tbody>
                        {rows.map(([k, st]) => (
                          <tr key={k} className="border-t border-border"><td className="py-1 pr-3 font-medium">{translateText(k)}</td><td className="pr-3 text-right font-mono">{translateText(st.count)}</td><td className="pr-3 text-right font-mono">{translateText(num(st.min))}</td><td className="pr-3 text-right font-mono">{translateText(num(st.mean))}</td><td className="text-right font-mono">{translateText(num(st.max))}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </Panel>
                )
              })}
            </div>
          )}
          {methods.length === 0 && estMethods.length > 0 && <Empty>{translateText("Sem comparação: inclua o estágio compare para ver o erro em relação à simulação completa.")}</Empty>}
        </div>
      </div>
    </ExportContext.Provider>
  )
}
