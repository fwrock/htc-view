"use client"

import { useI18n } from "@/components/i18n-provider"

import { useEffect, useMemo, useState } from "react"
import { Check, Copy, Loader2 } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import type { Setting } from "@/lib/htc-api"
import {
  exportEngineSettings,
  getEngineSettings,
  listLocations,
  type EngineSettingDef,
  type SimLocation,
} from "@/lib/simedape-api"

const KNOWN_FORMATS = ["parquet", "json", "csv", "kafka"] as const
const REPORT = "htc.report-manager."
const strategiesOf = (def: string) =>
  def.replace(/[[\]"]/g, "").split(",").map((x) => x.trim()).filter(Boolean)
const input =
  "h-8 rounded-sm border border-input bg-background px-2 text-xs focus:border-ring focus:ring-1 focus:ring-ring/30 focus:outline-none"

/** Settings of the report manager that the engine API CAN change while it runs. */
const LIVE_PREFIX = "htc.report-manager."

function CopyBlock({ title, text }: { title: string; text: string }) {
  const { t: translateText } = useI18n()

  const [copied, setCopied] = useState(false)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium">{translateText(title)}</span>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            })
          }}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? translateText("Copiado") : translateText("Copiar")}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-sm border border-border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed">{text}</pre>
    </div>
  )
}

export function OutputPanel({
  settings,
  onSaveSettings,
  setOverrides,
  onOpenEnv,
}: {
  settings: Setting[]
  onSaveSettings: (overrides: Record<string, string>) => Promise<void>
  /** Pending changes shared with the Ambiente tab. */
  setOverrides: React.Dispatch<React.SetStateAction<Record<string, string>>>
  onOpenEnv: () => void
}) {
  const { t: translateText } = useI18n()

  const [outputs, setOutputs] = useState<SimLocation[]>([])
  const [locId, setLocId] = useState("")
  const [catalog, setCatalog] = useState<EngineSettingDef[]>([])
  const [formats, setFormats] = useState<string[]>([])
  const [preview, setPreview] = useState<{ env: string; hocon: string; error?: string } | null>(null)
  const [added, setAdded] = useState<number | null>(null)
  const [engineHost, setEngineHost] = useState("")
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    listLocations("output")
      .then((r) => {
        setOutputs(r.locations)
        setLocId((cur) => cur || r.locations[0]?.id || "")
      })
      .catch(() => setOutputs([]))
  }, [])

  useEffect(() => {
    getEngineSettings()
      .then((r) => {
        setCatalog(r.settings)
        const def = r.settings.find((d) => d.path === `${REPORT}enabled-strategies`)?.default ?? ""
        // Start from the application.conf default so nothing changes until you decide.
        setFormats(strategiesOf(def).filter((f) => (KNOWN_FORMATS as readonly string[]).includes(f)))
      })
      .catch(() => setCatalog([]))
  }, [])

  const loc = outputs.find((l) => l.id === locId)
  useEffect(() => {
    setEngineHost(loc?.kind === "clickhouse" ? (loc.host ?? "") : "")
  }, [loc])

  const live = useMemo(() => settings.filter((s) => s.key.startsWith(LIVE_PREFIX)), [settings])

  async function saveLive() {
    setBusy(true)
    setMsg(null)
    try {
      await onSaveSettings(edits)
      setEdits({})
      setMsg({ ok: true, text: "Settings de relatório aplicadas ao engine." })
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  // Settings the chosen destination implies, built only from keys that exist in application.conf.
  const { derived, missing } = useMemo(() => {
    const out: Record<string, string> = {}
    const wanted: Record<string, string> = {}
    if (loc) {
      const strategies = loc.kind === "clickhouse" ? [...new Set([...formats, "clickhouse"])] : formats
      wanted[`${REPORT}enabled-strategies`] = strategies.join(", ")
      if (loc.kind === "clickhouse") {
        wanted[`${REPORT}clickhouse.host`] = engineHost || loc.host || "localhost"
        wanted[`${REPORT}clickhouse.port`] = String(loc.port || (loc.secure ? 8443 : 8123))
        wanted[`${REPORT}clickhouse.database`] = loc.database ?? ""
        wanted[`${REPORT}clickhouse.username`] = loc.user || "default"
      } else {
        const base = (loc.container_path || loc.path).replace(/\/+$/, "")
        for (const f of formats.filter((x) => ["parquet", "json", "csv"].includes(x)))
          wanted[`${REPORT}${f}.directory`] = `${base}/${f}`
      }
    }
    const byPath = new Map(catalog.map((d) => [d.path, d]))
    const same = (def: EngineSettingDef, v: string) =>
      def.type === "list"
        ? strategiesOf(def.default).join(",") === strategiesOf(v).join(",")
        : def.default.replace(/^"(.*)"$/, "$1") === v
    const gone: string[] = []
    for (const [k, v] of Object.entries(wanted)) {
      const def = byPath.get(k)
      if (!def) gone.push(k)
      else if (!same(def, v)) out[k] = v          // equal to the application.conf default: nothing to change
    }
    return { derived: out, missing: gone }
  }, [loc, formats, engineHost, catalog])

  // Same server-side generator as the Ambiente tab: only values that differ from the defaults.
  useEffect(() => {
    if (Object.keys(derived).length === 0) {
      setPreview(null)
      return
    }
    const t = setTimeout(() => {
      Promise.all([exportEngineSettings("env", derived), exportEngineSettings("hocon", derived)])
        .then(([e, h]) => setPreview({ env: e.text, hocon: h.text }))
        .catch((e) => setPreview({ env: "", hocon: "", error: (e as Error).message }))
    }, 250)
    return () => clearTimeout(t)
  }, [derived])

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-semibold">{translateText("Relatórios (aplicável agora)")}</h3>
          <p className="text-[11px] text-muted-foreground">{translateText("Settings do gerenciador de relatórios que a API do engine aceita alterar com ele em execução.")}</p>
        </div>
        {live.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">{translateText("O engine não expôs settings de relatório.")}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {live.map((s) => {
              const value = edits[s.key] ?? s.currentValue
              const isBool = s.defaultValue === "true" || s.defaultValue === "false"
              return (
                <label key={s.key} className="flex flex-col gap-1 text-xs">
                  <span className="font-medium">
                    {translateText(s.description ?? s.key)}
                    <span className="ml-2 rounded-sm bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase text-muted-foreground">{s.source === "api_override" ? translateText("override") : s.source === "env_var" ? translateText("env") : translateText("padrão")}</span>
                  </span>
                  {isBool ? (
                    <select className={input} value={value} onChange={(e) => setEdits({ ...edits, [s.key]: e.target.value })}>
                      <option value="true">{translateText("ativado")}</option>
                      <option value="false">{translateText("desativado")}</option>
                    </select>
                  ) : (
                    <input className={input} value={value} onChange={(e) => setEdits({ ...edits, [s.key]: e.target.value })} />
                  )}
                  <span className="font-mono text-[10px] text-muted-foreground">{translateText(s.key)}</span>
                </label>
              )
            })}
          </div>
        )}
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={saveLive} disabled={busy || Object.keys(edits).length === 0}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}{translateText(" Aplicar ao engine")}</Button>
          {msg && <span role="status" className={cn("text-xs", msg.ok ? "text-green-600 dark:text-green-400" : "text-destructive")}>{translateText(msg.text)}</span>}
        </div>
      </section>

      <section className="flex flex-col gap-3 border-t border-border pt-4">
        <div>
          <h3 className="text-sm font-semibold">{translateText("Destino dos resultados")}</h3>
          <p className="text-[11px] text-muted-foreground">{translateText("Escolha um local de saída do registro e veja a configuração que o engine precisa.")}</p>
        </div>
        <div className="rounded-sm border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-[11px] text-yellow-700 dark:text-yellow-400">{translateText("A pasta de saída, as estratégias de relatório e o ClickHouse ")}<b>{translateText("não estão no catálogo de settings da API do engine")}</b>{translateText(": são lidos do ")}<code className="font-mono">application.conf</code>{translateText(" e do ambiente quando o engine inicia. O que está abaixo vale na ")}<b>{translateText("próxima inicialização")}</b>{translateText(", não ao vivo.")}</div>
        {outputs.length === 0 ? (
          <p className="text-xs text-muted-foreground">{translateText("Nenhum local de saída cadastrado. Adicione um em Locais.")}</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-medium">{translateText("Local de saída")}</span>
                <select className={input} value={locId} onChange={(e) => setLocId(e.target.value)}>
                  {outputs.map((l) => <option key={l.id} value={l.id}>{translateText(l.label || l.id)} ({translateText(l.kind)})</option>)}
                </select>
              </label>
              {loc?.kind === "clickhouse" && (
                <label className="flex flex-col gap-1 text-xs">
                  <span className="font-medium">{translateText("Host visto pelo engine")}</span>
                  <input className={input} value={engineHost} onChange={(e) => setEngineHost(e.target.value)} />
                  <span className="text-[11px] text-muted-foreground">{translateText("No docker-compose o engine usa o nome do serviço (")}<code className="font-mono">clickhouse</code>{translateText("), não localhost.")}</span>
                </label>
              )}
            </div>
            <div>
              <p className="mb-1 text-xs font-medium">{translateText("Formatos gravados ")}{loc?.kind === "clickhouse" ? translateText("(além do ClickHouse)") : translateText("")}</p>
              <div className="flex flex-wrap gap-4 text-xs">
                {KNOWN_FORMATS.map((f) => (
                  <label key={f} className="flex items-center gap-1.5">
                    <input type="checkbox" checked={formats.includes(f)} onChange={(e) => setFormats(e.target.checked ? [...formats, f] : formats.filter((x) => x !== f))} />
                    {translateText(f)}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{translateText("Começa pelo padrão do application.conf. Kafka não usa o local escolhido; só entra na lista de estratégias.")}</p>
            </div>
            {missing.length > 0 && <p className="text-[11px] text-yellow-700 dark:text-yellow-400">{translateText("Chaves ausentes neste application.conf (ignoradas): ")}{translateText(missing.join(", "))}</p>}
            {loc && !loc.container_path && loc.kind !== "clickhouse" && (
              <p className="text-[11px] text-yellow-700 dark:text-yellow-400">{translateText("Este local não tem “caminho visto pelo engine”: o caminho do host será usado. Em Docker ou GKE, defina-o em Locais.")}</p>
            )}
            {loc?.kind === "clickhouse" && loc.password_env && (
              <p className="text-[11px] text-muted-foreground">{translateText("A senha não é exportada: defina ")}<code className="font-mono">HTC_CLICKHOUSE_PASSWORD</code>{translateText(" no ambiente do engine com o valor de ")}<code className="font-mono">{loc.password_env}</code>.</p>
            )}
            {preview?.error && <p className="text-xs text-destructive" role="alert">{translateText(preview.error)}</p>}
            {preview && !preview.error && (
              <div className="flex flex-col gap-3">
                {preview.env && <CopyBlock title={translateText("Variáveis de ambiente do engine")} text={preview.env} />}
                <CopyBlock title={translateText("application.conf (ou -Dconfig.file): inclui as chaves sem variável")} text={preview.hocon} />
                <div className="flex flex-wrap items-center gap-3">
                  <Button size="sm" onClick={() => { setOverrides((o) => ({ ...o, ...derived })); setAdded(Object.keys(derived).length); onOpenEnv() }}>{translateText("Levar para a aba Ambiente")}</Button>
                  <span className="text-[11px] text-muted-foreground">{translateText("Junta ao que você já alterou lá e exporta tudo num só arquivo (.env, compose, Kubernetes…).")}{added != null && translateText(" {0} chave(s) adicionadas.", { 0: added })}</span>
                </div>
              </div>
            )}
            {Object.keys(derived).length > 0 && !preview && <p className="text-[11px] text-muted-foreground">{translateText("Nada a alterar: esta escolha é igual ao padrão do application.conf.")}</p>}
          </>
        )}
      </section>
    </div>
  )
}
