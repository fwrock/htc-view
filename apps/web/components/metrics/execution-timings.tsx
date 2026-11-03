"use client"

import { useI18n } from "@/components/i18n-provider"
import { executionTimings, TIMING_LABELS } from "@/lib/execution-timings"
import type { MetricsStore } from "@/lib/metrics-store"
import { Panel, Stat } from "./charts"

export function ExecutionTimings({ store }: { store: MetricsStore }) {
  const { t, intlLocale } = useI18n()
  const timings = executionTimings(store.latest)
  const number = (v: number | null) =>
    v === null
      ? "—"
      : v.toLocaleString(intlLocale, { maximumFractionDigits: 6 })
  if (timings.length === 0)
    return (
      <p className="p-4 text-xs text-muted-foreground">
        {t(
          "Este engine ainda não publica os cronômetros de execução. Use uma versão com htc_execution_*."
        )}
      </p>
    )
  const columns = [
    "Operação",
    "Nó",
    "Chamadas concluídas",
    "Ativos",
    "Falhas ou cancelamentos",
    "Decorrido (s)",
    "Acumulado concluído (s)",
    "Média (s)",
    "Máximo (s)",
    "Último (s)",
  ].map((label) => t(label))
  const rows = timings.map((row) => [
    t(TIMING_LABELS[row.operation] ?? row.operation),
    row.node || t("este nó"),
    row.count,
    row.active,
    row.failed,
    row.elapsedSeconds,
    row.totalSeconds,
    row.meanSeconds,
    row.maxSeconds,
    row.lastSeconds,
  ])
  const elapsed = (operation: string) => {
    const values = timings.filter((row) => row.operation === operation)
    return values.length
      ? `${number(values.reduce((sum, row) => sum + row.elapsedSeconds, 0))} s`
      : "—"
  }
  return (
    <>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t(
          "Tempos reais medidos com relógio monotônico, acumulados desde o início de cada processo. O loop inclui pausas e esperas. Carga progressiva, sincronização e rotas podem se sobrepor; a soma das linhas não é o tempo total da simulação nem tempo de CPU."
        )}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={t("Loop da simulação")}
          value={elapsed("simulation_loop")}
        />
        <Stat
          label={t("Sincronização dos gerenciadores de tempo")}
          value={elapsed("time_manager_synchronization")}
        />
        <Stat
          label={t("Carga inicial da simulação")}
          value={elapsed("simulation_load")}
        />
        <Stat
          label={t("Carga de janelas progressivas")}
          value={elapsed("progressive_load")}
        />
      </div>
      <Panel
        title={t("Cronômetros de execução")}
        data={{ kind: "table", columns, rows }}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th
                    key={column}
                    className="border-b border-border px-2 py-2 text-left font-medium whitespace-nowrap"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={`${timings[i]!.node}:${timings[i]!.operation}`}>
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className={`border-b border-border px-2 py-2 ${j > 1 ? "text-right font-mono tabular-nums" : "whitespace-nowrap"}`}
                    >
                      {typeof cell === "number" || cell === null
                        ? number(cell)
                        : cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <p className="text-[11px] text-muted-foreground">
        {t(
          "As distribuições contam chamadas concluídas; o decorrido também inclui cronômetros ativos. Falhas contam exceções e cancelamentos. Rotas incluem cache e tentativas sem caminho, mas não rotas pré-calculadas nem leituras de replay."
        )}
      </p>
    </>
  )
}
