"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2, Play } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { useI18n } from "@/components/i18n-provider"
import { planTrainingResume, resumeTraining, type RunSummary, type TrainingResumeOptions, type TrainingResumePlan } from "@/lib/simedape-api"
import { recoveryCandidates } from "@/lib/simedape-training"

const input = "h-8 rounded-sm border border-border bg-background px-2 text-xs"

export function TrainingRecovery({ runs, disabled, currentOptions, onStarted }: {
  runs: RunSummary[]
  disabled: boolean
  currentOptions: TrainingResumeOptions | null
  onStarted: (result: { run_id: string; output_dir: string; plan: TrainingResumePlan }) => Promise<void>
}) {
  const { t } = useI18n()
  const candidates = useMemo(() => recoveryCandidates(runs), [runs])
  const [source, setSource] = useState("")
  const [from, setFrom] = useState<NonNullable<TrainingResumeOptions["from_stage"]>>("auto")
  const [useCurrent, setUseCurrent] = useState(false)
  const [saveData, setSaveData] = useState(true)
  const [plan, setPlan] = useState<TrainingResumePlan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [starting, setStarting] = useState(false)
  const options = useMemo<TrainingResumeOptions>(() => ({
    ...(useCurrent && currentOptions ? currentOptions : {}), from_stage: from, checkpoint_data: saveData,
  }), [useCurrent, currentOptions, from, saveData])

  useEffect(() => {
    if (!source || !candidates.some(run => run.run_id === source)) {
      setSource(candidates.find(run => run.status === "failed")?.run_id ?? candidates[0]?.run_id ?? "")
    }
  }, [candidates, source])

  useEffect(() => {
    let cancelled = false
    setPlan(null); setError(null); setLoading(false)
    if (!source) return
    if (useCurrent && !currentOptions) { setError(t("Corrija os parâmetros do treino antes de aplicá-los.")); return }
    setLoading(true)
    planTrainingResume(source, options)
      .then(value => { if (!cancelled) setPlan(value) })
      .catch(reason => { if (!cancelled) setError((reason as Error).message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [source, options, useCurrent, currentOptions, t])

  async function start() {
    if (!plan) return
    setStarting(true); setError(null)
    try { await onStarted(await resumeTraining(source, options)) }
    catch (reason) { setError((reason as Error).message) }
    finally { setStarting(false) }
  }

  return <section className="flex flex-col gap-3 rounded-sm border border-border p-3">
    <div>
      <p className="text-xs font-medium">{t("Retomar ou carregar etapas salvas")}</p>
      <p className="text-[11px] text-muted-foreground">{t("Escolha uma execução concluída, interrompida ou com falha. A retomada cria um novo snapshot e preserva a execução original.")}</p>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-xs">{t("Execução de origem")}
        <select aria-label="Training recovery source" className={input} value={source} onChange={event => setSource(event.target.value)} disabled={starting || candidates.length === 0}>
          {!candidates.length && <option value="">{t("Nenhuma execução de treino disponível")}</option>}
          {candidates.map(run => <option key={run.run_id} value={run.run_id}>{run.name} · {run.status}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs">{t("Recomeçar a partir de")}
        <select aria-label="Training recovery stage" className={input} value={from} onChange={event => setFrom(event.target.value as typeof from)} disabled={starting}>
          <option value="auto">{t("Automático — reutilizar o que está salvo")}</option>
          <option value="data_load">{t("Carregar a base novamente")}</option>
          <option value="process_dataset">{t("Normalizar novamente")}</option>
          <option value="clustering">{t("Agrupar novamente")}</option>
          <option value="warping_paths">{t("Recalcular warping paths")}</option>
          <option value="pca_train">{t("Treinar PCA novamente")}</option>
        </select>
      </label>
    </div>
    <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={useCurrent} onChange={event => setUseCurrent(event.target.checked)} disabled={starting} />
      {t("Aplicar os parâmetros atuais do treino; mudanças podem exigir recalcular etapas.")}
    </label>
    <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={saveData} onChange={event => setSaveData(event.target.checked)} disabled={starting} />
      {t("Salvar também a base carregada e normalizada para futuras retomadas. Usa espaço adicional em disco.")}
    </label>
    {loading && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" />{t("Verificando checkpoints salvos…")}</p>}
    {plan && <div className="flex flex-col gap-1 text-xs">
      <p>{t("Reutilizar:")} <span className="font-mono">{plan.reused_steps.join(" → ") || "—"}</span></p>
      <p>{t("Calcular:")} <span className="font-mono">{plan.computed_steps.join(" → ")}</span></p>
      {plan.saved_dtw_directory && <p className="text-emerald-700 dark:text-emerald-400">{t("Caminhos DTW salvos: o cálculo será ignorado.")}</p>}
      <p className="break-all font-mono text-[10px] text-muted-foreground">{plan.source_dir}</p>
      {plan.model_summary.n_clusters !== undefined && <p>{t("Clusters salvos:")} {plan.model_summary.n_clusters} · {t("Séries:")} {plan.model_summary.n_series}</p>}
      {plan.warnings.map(message => <p key={message} className="text-[11px] text-amber-700 dark:text-amber-400">{t(message)}</p>)}
    </div>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    <Button size="sm" className="self-start" disabled={disabled || starting || loading || !plan} onClick={() => void start()}>
      {starting ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}{t("Retomar treino em novo snapshot")}
    </Button>
  </section>
}
