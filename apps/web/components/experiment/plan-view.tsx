"use client"

import { useI18n } from "@/components/i18n-provider"

import { useState } from "react"
import { Play } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import type { ExperimentsStatus, Plan, StartOptions, ValidateResult } from "@/lib/experiment-api"
import { LABEL } from "./fields"

export function PlanView({ result, validating, status, sets, onSets, onRun, starting, error }: {
  result: ValidateResult | null; validating: boolean; status: ExperimentsStatus | null
  sets: string; onSets: (v: string) => void
  onRun: (opts: Pick<StartOptions, "confirm_billable" | "force" | "keep_env" | "only">) => void
  starting: boolean; error: string | null
}) {
  const { t: translateText } = useI18n()

  const [confirm, setConfirm] = useState(false)
  const [force, setForce] = useState(false)
  const [keepEnv, setKeepEnv] = useState(false)
  const [only, setOnly] = useState<string[]>([])
  const plan: Plan | null = result && result.valid ? result.plan : null
  const steps = plan ? [...new Set(plan.instances.map((i) => i.step))] : []
  const env = plan?.environment
  const blocked = !plan || !status?.run_enabled || (env?.requires_confirmation && !confirm)

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="exp-sets" className={LABEL}>{translateText("Sobrescritas (")}<span className="font-mono">{translateText("--set")}</span>{translateText("), uma por linha: ")}<span className="font-mono">{translateText("nome=valor")}</span>, <span className="font-mono">{translateText("matrix.pct=5,10")}</span>, <span className="font-mono">{translateText("environment.nodes=5")}</span></label>
        <textarea id="exp-sets" className="w-full rounded-sm border border-input bg-background px-2 py-1.5 font-mono text-[11px]" rows={2} value={sets} onChange={(e) => onSets(e.target.value)} />
      </div>

      {validating && <p className="text-xs text-muted-foreground" role="status">{translateText("Validando…")}</p>}
      {result && !result.valid && (
        <section aria-label={translateText("Problemas")} className="rounded-sm border border-destructive/40 bg-destructive/5 p-3">
          <h3 className="mb-1 text-xs font-semibold text-destructive">{translateText(result.problems.length)}{translateText(" problema(s) — corrija para ver o plano")}</h3>
          <ul className="flex flex-col gap-0.5 text-xs">
            {result.problems.map((p, i) => <li key={i}><span className="font-mono text-destructive">{translateText(p.path || "(documento)")}</span>: {translateText(p.message)}</li>)}
          </ul>
        </section>
      )}

      {plan && env && (
        <>
          <section className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-xs" aria-label={translateText("Resumo")}>
            <span><b>{translateText(plan.counts.total ?? 0)}</b>{translateText(" instância(s)")}</span>
            {Object.entries(plan.counts).filter(([k]) => k !== "total").map(([k, v]) => <span key={k} className="text-muted-foreground"><b className="text-foreground">{translateText(v)}</b> {translateText(k)}</span>)}
          </section>
          {plan.warnings.length > 0 && (
            <ul className="rounded-sm border border-amber-500/50 bg-amber-500/10 p-2 text-xs" aria-label={translateText("Avisos")}>
              {plan.warnings.map((w, i) => <li key={i}>{translateText(w)}</li>)}
            </ul>
          )}

          <section aria-label={translateText("Ambiente")}>
            <h3 className="mb-1 text-xs font-semibold">{translateText("Ambiente: ")}<span className="font-mono">{translateText(env.kind)}</span>{env.nodes ? translateText(" · {0} nó(s)", { 0: env.nodes }) : translateText("")}{translateText(" · teardown: ")}{translateText(env.teardown_policy)}{env.ttl_minutes ? translateText(" · ttl {0} min", { 0: env.ttl_minutes }) : translateText("")}</h3>
            <div className="flex flex-wrap gap-1.5">
              {env.phases.map((p) => (
                <span key={p.phase} className={`rounded-sm border px-2 py-1 text-[11px] ${p.active ? "border-primary/50 bg-primary/10" : "border-border text-muted-foreground line-through"}`}>
                  {translateText(p.phase)}{p.hooks.length ? translateText(" ({0})", { 0: p.hooks.join("/") }) : translateText("")}{p.overridden ? translateText(" ⟲") : translateText("")}{p.creates_billable_infrastructure ? translateText(" $") : translateText("")}
                </span>
              ))}
            </div>
            {env.destructive.length > 0 && (
              <div className="mt-2 rounded-sm border border-amber-500/50 bg-amber-500/10 p-2 text-xs">
                <p className="font-semibold">{translateText("Isto altera infraestrutura paga:")}</p>
                <ul className="list-disc pl-5">{env.destructive.map((d, i) => <li key={i}>{translateText(d)}</li>)}</ul>
                <label className="mt-1.5 flex items-center gap-1.5"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />{translateText(" Entendo e confirmo")}</label>
              </div>
            )}
          </section>

          <section aria-label={translateText("Passos do plano")}>
            <h3 className="mb-1 text-xs font-semibold">{translateText("Ordem de execução")}</h3>
            <div className="max-h-96 overflow-auto rounded-sm border border-border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted text-left"><tr><th className="px-2 py-1 font-normal">#</th><th className="px-2 font-normal">{translateText("instância")}</th><th className="px-2 font-normal">{translateText("tipo")}</th><th className="px-2 font-normal">{translateText("depende de")}</th><th className="px-2 font-normal">{translateText("chave")}</th></tr></thead>
                <tbody>
                  {plan.order.map((id, i) => {
                    const inst = plan.instances.find((x) => x.id === id)!
                    return (
                      <tr key={id} className="border-t border-border">
                        <td className="px-2 py-1 text-muted-foreground">{translateText(i + 1)}</td>
                        <td className="px-2 font-mono">{translateText(id)}</td><td className="px-2">{translateText(inst.type)}</td>
                        <td className="max-w-80 truncate px-2 font-mono text-[10px] text-muted-foreground" title={translateText(inst.needs.join(", "))}>{inst.needs.length ? translateText(inst.needs.join(", ")) : translateText("—")}</td>
                        <td className="px-2 font-mono text-[10px] text-muted-foreground">{translateText(inst.key.slice(0, 8))}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-label={translateText("Executar")} className="flex flex-col gap-3 rounded-sm border border-border p-3">
            <h3 className="text-xs font-semibold">{translateText("Executar")}</h3>
            {steps.length > 1 && (
              <fieldset className="flex flex-wrap items-center gap-3 text-xs"><legend className={LABEL}>{translateText("Só estes passos (e o que eles precisam); nenhum marcado = todos")}</legend>
                {steps.map((s) => <label key={s} className="flex items-center gap-1"><input type="checkbox" checked={only.includes(s)} onChange={(e) => setOnly(e.target.checked ? [...only, s] : only.filter((x) => x !== s))} /> <span className="font-mono">{translateText(s)}</span></label>)}
              </fieldset>
            )}
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />{translateText(" ignorar o cache")}</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={keepEnv} onChange={(e) => setKeepEnv(e.target.checked)} />{translateText(" manter o ambiente ligado no fim")}</label>
            </div>
            {status && !status.run_enabled && <p className="text-xs text-amber-700 dark:text-amber-400" role="status">{translateText(status.hint ?? "A execução está desligada neste servidor.")}</p>}
            {error && <p className="text-xs text-destructive" role="alert">{translateText(error)}</p>}
            <div>
              <Button type="button" disabled={!!blocked || starting} onClick={() => onRun({ confirm_billable: confirm, force, keep_env: keepEnv, only })}>
                <Play className="size-3.5" /> {starting ? translateText("Iniciando…") : translateText("Executar experimento")}
              </Button>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
