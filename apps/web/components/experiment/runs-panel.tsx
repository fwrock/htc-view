"use client"

import { useI18n } from "@/components/i18n-provider"

import { useCallback, useEffect, useRef, useState } from "react"
import { FileText, Trash2 } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  artifactUrl, cancelExperimentRun, deleteExperimentRun, getExperimentRun, getRunLog, interruptExperimentRun,
  listExperimentRuns, listRunLogs, type Json, type RunDetail, type RunSummary,
} from "@/lib/experiment-api"
import { INPUT, LABEL } from "./fields"

const TONE: Record<string, string> = {
  succeeded: "bg-green-500/15 text-green-700 dark:text-green-400", done: "bg-green-500/15 text-green-700 dark:text-green-400",
  cached: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  running: "bg-primary/15 text-primary", starting: "bg-primary/15 text-primary", retrying: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  failed: "bg-destructive/15 text-destructive", lost: "bg-destructive/15 text-destructive",
  cancelled: "bg-amber-500/15 text-amber-700 dark:text-amber-400", skipped: "bg-muted text-muted-foreground",
  pending: "bg-muted text-muted-foreground", not_selected: "bg-muted text-muted-foreground",
}
const LABELS: Record<string, string> = {
  succeeded: "concluído", done: "feito", cached: "em cache", running: "executando", starting: "iniciando", retrying: "repetindo",
  failed: "falhou", lost: "perdido", cancelled: "cancelado", skipped: "pulado", pending: "pendente", not_selected: "não selecionado",
}
const Badge = ({ s }: { s: string }) => {
 const { t: translateText } = useI18n()
 return (<span className={`rounded-sm px-1.5 py-0.5 text-[10px] ${TONE[s] ?? "bg-muted"}`}>{translateText(LABELS[s] ?? s)}</span>)
}
const ACTIVE = (s: string) => ["starting", "pending", "running"].includes(s)
const when = (t: number | null, intlLocale: string) => (t ? new Date(t * 1000).toLocaleString(intlLocale) : "—")

export function RunsPanel({ selected, onSelect }: { selected: string | null; onSelect: (id: string | null) => void }) {
  const { t: translateText, intlLocale } = useI18n()

  const [runs, setRuns] = useState<RunSummary[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try { setRuns((await listExperimentRuns()).runs); setError(null) } catch (e) { setError((e as Error).message) }
  }, [])
  useEffect(() => {
    const first = setTimeout(refresh, 0)
    const t = setInterval(refresh, 3000)
    return () => { clearTimeout(first); clearInterval(t) }
  }, [refresh])

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
      <div className="flex flex-col gap-2">
        {error && <p className="text-xs text-destructive" role="alert">{translateText(error)}</p>}
        {runs.length === 0 && !error && <p className="text-xs text-muted-foreground">{translateText("Nenhuma execução ainda.")}</p>}
        <ul className="flex flex-col gap-1" aria-label={translateText("Execuções")}>
          {runs.map((r) => (
            <li key={r.id}>
              <button type="button" aria-current={r.id === selected} onClick={() => onSelect(r.id)}
                className={`flex w-full flex-col gap-1 rounded-sm border px-2 py-1.5 text-left text-xs ${r.id === selected ? "border-primary bg-primary/10" : "border-border"}`}>
                <span className="flex items-center justify-between gap-2"><span className="truncate font-mono">{translateText(r.name)}</span><Badge s={r.status} /></span>
                <span className="text-[10px] text-muted-foreground">{translateText(when(r.started, intlLocale))} · {translateText(r.environment)} · {translateText(Object.entries(r.counts).map(([k, v]) => `${v} ${LABELS[k] ?? k}`).join(", ") || `${r.total} passo(s)`)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {selected ? <Monitor id={selected} onGone={() => { onSelect(null); refresh() }} /> : <p className="text-xs text-muted-foreground">{translateText("Escolha uma execução.")}</p>}
    </div>
  )
}

function Monitor({ id, onGone }: { id: string; onGone: () => void }) {
  const { t: translateText, intlLocale } = useI18n()

  const [detail, setDetail] = useState<RunDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [logs, setLogs] = useState<string[]>(["runner"])
  const [log, setLog] = useState("runner")
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const logBox = useRef<HTMLPreElement>(null)

  const active = detail ? ACTIVE(detail.summary.status) : true
  useEffect(() => {
    let stop = false
    const tick = async () => {
      try {
        const d = await getExperimentRun(id)
        if (stop) return
        setDetail(d); setError(null)
        setLogs((await listRunLogs(id)).logs)
        setText(await getRunLog(id, log, 400))
      } catch (e) {
        if (!stop) setError((e as Error).message)
      }
    }
    const first = setTimeout(tick, 0)
    const t = active ? setInterval(tick, 2000) : undefined
    return () => { stop = true; clearTimeout(first); if (t) clearInterval(t) }
  }, [id, log, active])
  useEffect(() => { if (logBox.current) logBox.current.scrollTop = logBox.current.scrollHeight }, [text])

  async function act(fn: () => Promise<unknown>) {
    setBusy(true)
    try { await fn(); setError(null) } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  if (!detail) return <p className="text-xs text-muted-foreground" role="status">{translateText(error ?? "Carregando…")}</p>
  const s = detail.summary
  const insts = detail.state?.instances ?? {}
  const files: { id: string; kind: string; path: string }[] = []
  for (const [iid, out] of Object.entries(detail.outputs)) {
    const f = out.files as Record<string, Json> | undefined
    if (f && typeof f === "object") for (const [k, p] of Object.entries(f)) if (typeof p === "string") files.push({ id: iid, kind: k, path: p })
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-mono text-sm">{translateText(s.name)}</h2><Badge s={s.status} />
        <span className="text-[11px] text-muted-foreground">{translateText(when(s.started, intlLocale))} → {translateText(when(s.finished, intlLocale))} · {translateText(s.environment)}</span>
        <div className="ml-auto flex gap-2">
          {s.alive && <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => cancelExperimentRun(id))}>{translateText("Cancelar")}</Button>}
          {s.alive && <Button size="sm" variant="ghost" disabled={busy} title={translateText("Se o cancelamento não surtir efeito: envia SIGINT ao orquestrador")} onClick={() => act(() => interruptExperimentRun(id))}>{translateText("Forçar")}</Button>}
          {!s.alive && <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(async () => { await deleteExperimentRun(id); onGone() })}><Trash2 className="size-3.5" />{translateText(" Apagar")}</Button>}
        </div>
      </div>
      {(s.error || detail.state?.error) && <p className="rounded-sm border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive" role="alert">{translateText(s.error || detail.state?.error)}</p>}
      {error && <p className="text-xs text-destructive" role="alert">{translateText(error)}</p>}
      {(detail.state?.warnings ?? []).map((w, i) => <p key={i} className="text-xs text-amber-700 dark:text-amber-400">{translateText("aviso: ")}{translateText(w)}</p>)}

      <section aria-label={translateText("Instâncias")}>
        <div className="max-h-80 overflow-auto rounded-sm border border-border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted text-left"><tr><th className="px-2 py-1 font-normal">{translateText("instância")}</th><th className="px-2 font-normal">{translateText("tipo")}</th><th className="px-2 font-normal">{translateText("estado")}</th><th className="px-2 font-normal">{translateText("detalhe")}</th></tr></thead>
            <tbody>
              {Object.entries(insts).map(([iid, st]) => (
                <tr key={iid} className="border-t border-border align-top">
                  <td className="px-2 py-1 font-mono">{translateText(iid)}</td><td className="px-2">{translateText(st.type)}</td><td className="px-2"><Badge s={st.status} /></td>
                  <td className="max-w-md px-2 text-[11px] text-muted-foreground">
                    {st.error ? <span className="whitespace-pre-wrap text-destructive">{translateText(st.error.slice(0, 400))}</span> : st.reason ?? (st.attempt && st.attempt > 1 ? `tentativa ${st.attempt}` : "")}
                    {detail.outputs[iid]?.simulation_id ? <span className="font-mono">{translateText(" sim ")}{translateText(String(detail.outputs[iid]!.simulation_id))}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {files.length > 0 && (
        <section aria-label={translateText("Arquivos gerados")}><h3 className="mb-1 text-xs font-semibold">{translateText("Arquivos gerados")}</h3>
          <ul className="flex flex-wrap gap-2">
            {files.map((f) => <li key={f.path}><a className="flex items-center gap-1.5 rounded-sm border border-border px-2 py-1 text-xs hover:bg-muted/50" href={artifactUrl(id, f.path, true)}><FileText className="size-3.5" />{translateText(f.kind)} <span className="text-muted-foreground">({translateText(f.id)})</span></a></li>)}
          </ul></section>
      )}

      <section aria-label={translateText("Logs")} className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <label htmlFor="exp-log" className={LABEL}>{translateText("Log")}</label>
          <select id="exp-log" className={`${INPUT} max-w-60`} value={log} onChange={(e) => setLog(e.target.value)}>{logs.map((l) => <option key={l} value={l}>{translateText(l)}</option>)}</select>
          {active && <span className="text-[10px] text-muted-foreground">{translateText("atualizando…")}</span>}
        </div>
        <pre ref={logBox} className="max-h-80 overflow-auto rounded-sm border border-border bg-muted/30 p-2 font-mono text-[11px] whitespace-pre-wrap">{text || "(vazio)"}</pre>
      </section>
    </div>
  )
}
