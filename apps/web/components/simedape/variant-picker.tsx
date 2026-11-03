"use client"

import { useI18n } from "@/components/i18n-provider"

import { useEffect, useMemo, useState } from "react"
import { cn } from "@workspace/ui/lib/utils"
import { getEstimationVariants, type EstimationVariant } from "@/lib/simedape-api"

const FAMILIES: { id: EstimationVariant["family"]; title: string; help: string }[] = [
  { id: "dtw", title: "DTW", help: "Alinha o ponto de simulação pelo warping path; os métodos diferem na normalização. A interpolação define como a série parcial é esticada antes do alinhamento." },
  { id: "pca", title: "PCA", help: "Reconstrói pelo espaço de componentes do cluster. 'sp' usa os pesos do ponto de simulação; 'ind' cada série; 'stretched' interpola e projeta. O filtro de autovalores suaviza os pesos." },
  { id: "pca_delta", title: "PCA Δ (deslocamento de pesos)", help: "Parte dos pesos de cada série no treino e soma o deslocamento observado no ponto de simulação (inteiro, metade ou ponderado)." },
]
const PRESETS: { label: string; pick: (all: EstimationVariant[]) => string[] }[] = [
  { label: "Básico (4 DTW)", pick: (a) => a.filter((v) => v.family === "dtw" && !v.interp).map((v) => v.key) },
  { label: "Básico + PCA sp", pick: (a) => a.filter((v) => (v.family === "dtw" && !v.interp) || v.key === "pca_sp").map((v) => v.key) },
  { label: "Todo DTW", pick: (a) => a.filter((v) => v.family === "dtw").map((v) => v.key) },
  { label: "Todo PCA", pick: (a) => a.filter((v) => v.family === "pca").map((v) => v.key) },
  { label: "Todo PCA Δ", pick: (a) => a.filter((v) => v.family === "pca_delta").map((v) => v.key) },
  { label: "Todas", pick: (a) => a.map((v) => v.key) },
]

/** Matrix of every estimation variation: rows are method/mode (x eigenvalue filter), columns the interpolation. */
export function VariantPicker({ value, onChange, available }: { value: string[]; onChange: (keys: string[]) => void; available: { dtw: boolean; pca: boolean } }) {
  const { t: translateText } = useI18n()

  const [all, setAll] = useState<EstimationVariant[]>([])
  const [interps, setInterps] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    getEstimationVariants().then((r) => { setAll(r.variants); setInterps(r.interpolations) }).catch((e) => setError((e as Error).message))
  }, [])
  const chosen = useMemo(() => new Set(value), [value])
  const byCell = useMemo(() => new Map(all.map((v) => [`${v.family}|${v.method}|${v.eig}|${v.interp ?? ""}`, v])), [all])
  const ok = (v: EstimationVariant) => (v.family === "dtw" ? available.dtw : available.pca)
  const toggle = (keys: string[], on: boolean) => {
    const next = new Set(value)
    for (const k of keys) on ? next.add(k) : next.delete(k)
    onChange([...next])
  }
  if (error) return <p className="text-[11px] text-destructive">{translateText("Variações indisponíveis: ")}{translateText(error)}</p>
  if (all.length === 0) return <p className="text-[11px] text-muted-foreground">{translateText("Carregando variações…")}</p>
  const columns: (string | null)[] = [null, ...interps]
  const selectable = all.filter(ok)
  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <button key={p.label} type="button" className="rounded-sm border border-border px-2 py-1 text-[11px] hover:bg-muted"
            onClick={() => onChange(p.pick(selectable))}>{translateText(p.label)}</button>
        ))}
        <button type="button" className="rounded-sm border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted" onClick={() => onChange([])}>{translateText("Limpar")}</button>
        <span className="ml-auto font-mono text-[11px]">{translateText(value.length)}{translateText(" de ")}{translateText(all.length)}{translateText(" variações")}</span>
      </div>
      {value.length > 12 && <p className="text-[11px] text-yellow-700 dark:text-yellow-400">{translateText("Cada variação roda sobre a parcial inteira; muitas variações demoram. Os resultados mostram um ranking e os melhores primeiro.")}</p>}
      {FAMILIES.map((fam) => {
        const members = all.filter((v) => v.family === fam.id)
        const rows = [...new Map(members.map((v) => [`${v.method}|${v.eig}`, { method: v.method, eig: v.eig }])).values()]
        const enabled = fam.id === "dtw" ? available.dtw : available.pca
        return (
          <fieldset key={fam.id} className={cn("rounded-sm border border-border p-3", !enabled && "opacity-50")}>
            <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{translateText(fam.title)}</legend>
            <p className="mb-2 text-[11px] text-muted-foreground">{translateText(fam.help)}{!enabled && translateText(" Indisponível: o snapshot em uso não treinou {0}.", { 0: fam.id === "dtw" ? translateText("DTW") : translateText("PCA") })}</p>
            <div className="overflow-x-auto">
              <table className="text-[11px]">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="pr-3 pb-1 font-normal">{translateText("método")}</th>
                    {columns.map((c) => {
                      const keys = members.filter((v) => (v.interp ?? null) === c).map((v) => v.key)
                      const allOn = keys.length > 0 && keys.every((k) => chosen.has(k))
                      return (
                        <th key={c ?? "padrão"} className="px-1.5 pb-1 text-center font-normal">
                          <label className="flex flex-col items-center gap-0.5"><span>{translateText(c ?? "padrão")}</span>
                            <input type="checkbox" disabled={!enabled || keys.length === 0} checked={allOn} onChange={(e) => toggle(keys, e.target.checked)} aria-label={translateText("coluna {0}", { 0: c ?? "padrão" })} /></label>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const rowKeys = members.filter((v) => v.method === row.method && v.eig === row.eig).map((v) => v.key)
                    return (
                      <tr key={`${row.method}|${row.eig}`} className="border-t border-border">
                        <td className="py-1 pr-3">
                          <label className="flex items-center gap-1.5 font-mono">
                            <input type="checkbox" disabled={!enabled} checked={rowKeys.every((k) => chosen.has(k))} onChange={(e) => toggle(rowKeys, e.target.checked)} aria-label={translateText("linha {0}", { 0: row.method })} />
                            {translateText(row.method)}{row.eig ? translateText(" · filtro λ") : translateText("")}
                          </label>
                        </td>
                        {columns.map((c) => {
                          const v = byCell.get(`${fam.id}|${row.method}|${row.eig}|${c ?? ""}`)
                          return (
                            <td key={c ?? "padrão"} className="px-1.5 py-1 text-center">
                              {v ? <input type="checkbox" disabled={!enabled} checked={chosen.has(v.key)} onChange={(e) => toggle([v.key], e.target.checked)} title={translateText("{0}: {1}", { 0: v.label, 1: v.help })} aria-label={translateText(v.label)} /> : <span className="text-muted-foreground/40">·</span>}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </fieldset>
        )
      })}
    </div>
  )
}
