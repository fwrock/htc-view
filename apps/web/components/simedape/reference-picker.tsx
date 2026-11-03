"use client"

import { useI18n } from "@/components/i18n-provider"

import { cn } from "@workspace/ui/lib/utils"

const input = "h-8 w-full rounded-sm border border-input bg-background px-2 font-mono text-xs focus:border-ring focus:ring-1 focus:ring-ring/30 focus:outline-none"

/** Which complete simulation the estimates are compared with: the training base (default) or another complete run. */
export function ReferencePicker({ value, onChange, isClickhouse, simulations, base, hasModifications }: {
  value: string
  onChange: (v: string) => void
  isClickhouse: boolean
  simulations: string[]
  base: string
  hasModifications: boolean
}) {
  const { t: translateText } = useI18n()

  const other = value !== ""
  return (
    <div className="flex flex-col gap-2 rounded-sm border border-border p-3 text-xs">
      <p className="font-medium">{translateText("Referência do erro (simulação completa)")}</p>
      <p className="text-[11px] text-muted-foreground">{translateText("O erro de cada variação é medido contra uma simulação ")}<b>{translateText("completa")}</b>{translateText(" (100%). Por padrão é a própria base do treino. Se a parcial foi alterada por modificações, a referência certa para medir o erro da estimativa é a execução completa ")}<b>{translateText("com as mesmas modificações")}</b>{translateText(" (botão no passo Parcial). Manter a base mede, em vez disso, o efeito da alteração em relação ao cenário original.")}</p>
      <label className="flex items-start gap-2">
        <input type="radio" className="mt-0.5" checked={!other} onChange={() => onChange("")} />
        <span>{translateText("A base do treino ")}<span className="font-mono text-[11px] text-muted-foreground">{translateText(base || "(não escolhida)")}</span></span>
      </label>
      <label className="flex items-start gap-2">
        <input type="radio" className="mt-0.5" checked={other} onChange={() => !other && onChange(simulations[0] ?? " ")} />
        <span className="flex flex-1 flex-col gap-1.5">
          <span>{translateText("Outra simulação completa")}{hasModifications ? translateText(" (a completa alterada)") : translateText("")}</span>
          <datalist id="reference-sims">{simulations.map((s) => <option key={s} value={s} />)}</datalist>
          <input className={cn(input, !other && "opacity-50")} list={isClickhouse ? "reference-sims" : undefined} disabled={!other}
            placeholder={isClickhouse ? translateText("simulation_id da completa") : translateText("/pasta/da/simulação/completa/")} value={other ? value.trim() === "" ? "" : value : ""} onChange={(e) => onChange(e.target.value || " ")} />
        </span>
      </label>
      {other && value.trim() === "" && <p className="text-[11px] text-yellow-700 dark:text-yellow-400">{translateText("Informe a simulação de referência, ou volte para a base.")}</p>}
    </div>
  )
}
