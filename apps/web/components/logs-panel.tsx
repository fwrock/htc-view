"use client"

import { useI18n } from "@/components/i18n-provider"

import { useCallback, useEffect, useRef, useState } from "react"
import { AlertCircle, Pause, Play, RotateCcw } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LogFileDescriptor {
  id: string
  label: string
  path: string
  exists?: boolean
  updatedAt?: number
}

interface LogsResponse {
  files: LogFileDescriptor[]
  file?: string
  lines: number
  logs: Record<string, string>
}

const DEFAULT_FILES: LogFileDescriptor[] = []

const LINE_OPTIONS = [100, 300, 500, 1000, 2000]

// ---------------------------------------------------------------------------
// Logs panel
// ---------------------------------------------------------------------------

export function LogsPanel() {
  const { t: translateText } = useI18n()

  const [files, setFiles] = useState<LogFileDescriptor[]>(DEFAULT_FILES)
  const [selected, setSelected] = useState<string>("")
  const userChose = useRef(false)
  const [logs, setLogs] = useState<Record<string, string>>({})
  const [lines, setLines] = useState(500)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const preRef = useRef<HTMLPreElement>(null)

  const fetchLogs = useCallback(
    async (file: string) => {
      try {
        const res = await fetch(
          `/api/logs?${file ? `file=${encodeURIComponent(file)}&` : ""}lines=${lines}`,
          { cache: "no-store" }
        )
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error ?? `HTTP ${res.status}`)
        }
        const data = (await res.json()) as LogsResponse
        setFiles(data.files)
        setLogs(data.logs)
        // Until you pick a source yourself, open the first one that exists and has content.
        if (!userChose.current && !(data.logs[file] ?? "")) {
          const next = data.files.find((f) => f.exists && data.logs[f.id])
            ?? data.files.find((f) => f.exists)
            ?? data.files[0]
          if (next) {
            userChose.current = true
            setSelected(next.id)
          }
        }
        setError(null)
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setLoading(false)
      }
    },
    [lines]
  )

  // Initial load + refetch when the selected file / line count changes
  useEffect(() => {
    setLoading(true)
    fetchLogs(selected)
  }, [selected, fetchLogs])

  // Auto-refresh every 3s while enabled
  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(() => fetchLogs(selected), 3000)
    return () => clearInterval(id)
  }, [autoRefresh, selected, fetchLogs])

  // Keep the tail pinned to the bottom while auto-refreshing
  useEffect(() => {
    if (autoRefresh && preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight
    }
  }, [logs, autoRefresh])

  const current = logs[selected] ?? ""

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={selected}
          onChange={(e) => {
            userChose.current = true
            setSelected(e.target.value)
          }}
          className="h-7 rounded-sm border border-input bg-background px-2 text-[11px] text-foreground focus:border-ring focus:ring-1 focus:ring-ring/30 focus:outline-none"
        >
          {files.map((f) => (
            <option key={f.id} value={f.id}>
              {translateText(f.label)}
              {f.exists === false ? translateText(" · sem arquivo") : translateText("")}
            </option>
          ))}
        </select>

        <select
          value={lines}
          onChange={(e) => setLines(parseInt(e.target.value, 10))}
          className="h-7 rounded-sm border border-input bg-background px-2 text-[11px] text-foreground focus:border-ring focus:ring-1 focus:ring-ring/30 focus:outline-none"
        >
          {LINE_OPTIONS.map((n) => (
            <option key={n} value={n}>{translateText("últimas ")}{translateText(n)}{translateText(" linhas")}</option>
          ))}
        </select>

        <button
          onClick={() => {
            setLoading(true)
            fetchLogs(selected)
          }}
          disabled={loading}
          className="flex items-center gap-1 rounded-sm border border-border px-2 py-1 text-[10px] text-muted-foreground hover:border-ring hover:text-foreground disabled:opacity-50"
        >
          <RotateCcw className={cn("size-3", loading && "animate-spin")} />{translateText("Atualizar")}</button>

        <button
          onClick={() => setAutoRefresh((v) => !v)}
          className={cn(
            "flex items-center gap-1 rounded-sm border px-2 py-1 text-[10px] transition-colors",
            autoRefresh
              ? "border-ring text-foreground"
              : "border-border text-muted-foreground hover:border-ring hover:text-foreground"
          )}
        >
          {autoRefresh ? (
            <Pause className="size-3" />
          ) : (
            <Play className="size-3" />
          )}
          {autoRefresh ? translateText("Auto (3s)") : translateText("Manual")}
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-sm border border-destructive/30 bg-destructive/8 px-3 py-2 text-[11px] text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <div>
            <p className="font-semibold">{translateText("Não foi possível ler os logs")}</p>
            <p className="mt-0.5 font-mono text-[10px] text-destructive/70">
              {translateText(error)}
            </p>
          </div>
        </div>
      )}

      <pre
        ref={preRef}
        className="max-h-96 overflow-auto rounded-sm border border-border bg-black/80 p-3 font-mono text-[10px] leading-relaxed text-emerald-200/90 dark:bg-black/60"
      >
        {current || (loading ? "A carregar…" : "(sem logs)")}
      </pre>
      {!current && !loading && (
        <p className="text-[11px] text-muted-foreground">
          {translateText("A stack usa HTC_LOGS_DIR para ler logs compartilhados de engine, Bus Live, SimEDaPE e View, inclusive em containers. ")}
          {files.find((f) => f.id === selected)?.exists === false ? translateText("O arquivo {0} não existe. ", { 0: files.find((f) => f.id === selected)?.path }) : translateText("O arquivo está vazio. ")}{translateText("Estas fontes são arquivos de log no servidor do HTC View: o demo nativo grava a API e o servidor web em")}{" "}
          <code className="font-mono">/tmp/htc-native-demo-&lt;uid&gt;/</code>{translateText(" e o engine de cada execução em")}{" "}
          <code className="font-mono">output/&lt;execução&gt;/engine.log</code>{translateText("; o demo ao vivo usa")}{" "}
          <code className="font-mono">/tmp/htc-engine.log</code>{translateText(". Os caminhos podem ser trocados por")}{" "}
          <code className="font-mono">HTC_ENGINE_LOG</code>, <code className="font-mono">HTC_API_LOG</code>, <code className="font-mono">HTC_VIEW_LOG</code>{" "}{translateText("e ")}<code className="font-mono">HTC_NATIVE_DEMO_DIR</code>.
        </p>
      )}
    </div>
  )
}
