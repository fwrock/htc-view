"use client"

import { useI18n } from "@/components/i18n-provider"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Check, Copy, Download, Loader2, RotateCcw, Save } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { getDispatcherSettings, type Setting } from "@/lib/htc-api"
import {
  exportEngineSettings,
  getEngineSettings,
  getEngineStartupProfile,
  saveEngineStartupProfile,
  type EngineStartupProfile,
  type EngineSettingDef,
  type EngineSettingScope,
  type ExportFormat,
} from "@/lib/simedape-api"

const FORMATS: { id: ExportFormat; label: string; file: string; hint: string }[] = [
  { id: "env", label: "Variáveis (.env)", file: "htc.env", hint: "Arquivo env_file do Docker ou export no shell." },
  { id: "compose", label: "docker-compose", file: "environment.yml", hint: "Bloco environment: do serviço do engine." },
  { id: "k8s", label: "Kubernetes", file: "env.yml", hint: "Lista env: do container." },
  { id: "hocon", label: "application.conf", file: "override.conf", hint: "Arquivo HOCON que inclui o application.conf; use -Dconfig.file. Serve para qualquer chave, inclusive listas." },
  { id: "jvm", label: "Flags -D", file: "jvm-options.txt", hint: "Opções do JVM. Listas usam índices (.0, .1), o que depende do Typesafe Config e não foi testado neste engine; prefira o arquivo HOCON para listas." },
]
const SCOPES: { id: EngineSettingScope | "all" | "changed"; label: string }[] = [
  { id: "env", label: "Com variável de ambiente" },
  { id: "hocon", label: "Só application.conf" },
  { id: "internal", label: "Internas (Pekko)" },
  { id: "all", label: "Todas" },
  { id: "changed", label: "Alteradas" },
]
const input =
  "h-8 w-full rounded-sm border border-input bg-background px-2 text-xs focus:border-ring focus:ring-1 focus:ring-ring/30 focus:outline-none"
const unquote = (v: string) => v.replace(/^"(.*)"$/, "$1")

function Editor({
  def,
  value,
  onChange,
}: {
  def: EngineSettingDef
  value: string | undefined
  onChange: (v: string | undefined) => void
}) {
  const { t: translateText } = useI18n()

  const shown = value ?? ""
  const placeholder = unquote(def.default)
  const options = def.options ?? []
  const label = translateText(def.path)

  const parseList = (raw: string): string[] => {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed.map(String)
    } catch {
      /* HOCON literal such as ["a", "b"] with loose quoting */
    }
    return raw.replace(/^\[|\]$/g, "").split(",").map((x) => x.trim().replace(/^"|"$/g, "")).filter(Boolean)
  }

  if (def.type === "bool") {
    const checked = (value ?? placeholder) === "true"
    return (
      <label className="flex h-8 items-center gap-2 text-xs">
        <input type="checkbox" className="size-4 accent-primary" checked={checked} aria-label={label}
          onChange={(e) => onChange(String(e.target.checked))} />
        <span>{checked ? translateText("ativado") : translateText("desativado")}</span>
        {value === undefined && <span className="text-[10px] text-muted-foreground">{translateText("(padrão)")}</span>}
      </label>
    )
  }
  if (def.type === "list" && options.length > 0) {
    const selected = parseList(value ?? def.default)
    const toggle = (opt: string, on: boolean) => {
      const next = options.filter((o) => (o === opt ? on : selected.includes(o)))
      onChange(JSON.stringify(next))
    }
    return (
      <fieldset className="flex flex-wrap gap-x-3 gap-y-1" aria-label={label}>
        {options.map((opt) => (
          <label key={opt} className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" className="size-4 accent-primary" checked={selected.includes(opt)}
              onChange={(e) => toggle(opt, e.target.checked)} />
            <span className="font-mono">{opt}</span>
          </label>
        ))}
      </fieldset>
    )
  }
  if (options.length > 0 && options.length <= 4) {
    const current = value ?? placeholder
    return (
      <fieldset className="flex flex-wrap gap-x-3 gap-y-1" aria-label={label}>
        {options.map((opt) => (
          <label key={opt} className="flex items-center gap-1.5 text-xs">
            <input type="radio" className="size-4 accent-primary" name={def.path} checked={current === opt}
              onChange={() => onChange(opt)} />
            <span className="font-mono">{opt}</span>
          </label>
        ))}
      </fieldset>
    )
  }
  if (options.length > 0) {
    return (
      <select className={input} value={shown} onChange={(e) => onChange(e.target.value || undefined)} aria-label={label}>
        <option value="">{translateText("padrão (")}{translateText(placeholder)})</option>
        {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    )
  }
  return (
    <input
      className={cn(input, ["int", "float"].includes(def.type) ? "" : "font-mono")}
      type={def.type === "int" || def.type === "float" ? "number" : "text"}
      step={def.type === "float" ? "any" : undefined}
      value={shown}
      placeholder={translateText(placeholder || "(vazio)")}
      onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
      aria-label={translateText(def.path)}
    />
  )
}

export function EnvSettingsPanel({
  liveSettings,
  onApplyLive,
  overrides,
  setOverrides,
}: {
  /** Pending changes, shared with the Saída tab (kept by the page). */
  overrides: Record<string, string>
  setOverrides: React.Dispatch<React.SetStateAction<Record<string, string>>>
  /** What the running engine's API exposes (applicable without restarting). */
  liveSettings: Setting[]
  onApplyLive: (overrides: Record<string, string>) => Promise<void>
}) {
  const { t: translateText } = useI18n()

  const [catalog, setCatalog] = useState<EngineSettingDef[] | null>(null)
  const [source, setSource] = useState("")
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [scope, setScope] = useState<EngineSettingScope | "all" | "changed">("all")
  const [group, setGroup] = useState("")
  const [format, setFormat] = useState<ExportFormat>("env")
  const [exported, setExported] = useState<{ text: string; error?: string }>({ text: "" })
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [liveMsg, setLiveMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [profile, setProfile] = useState<EngineStartupProfile | null>(null)
  const [profileMessage, setProfileMessage] = useState("")
  const [configResource, setConfigResource] = useState("application.conf")
  const [configFiles, setConfigFiles] = useState("")
  const [dispatcherValues, setDispatcherValues] = useState<Record<string, string>>({})

  useEffect(() => {
    getEngineSettings()
      .then((r) => {
        setCatalog(r.settings)
        setSource(r.source)
      })
      .catch((e) => setLoadError((e as Error).message))
  }, [])
  useEffect(() => {
    getEngineStartupProfile().then((saved) => {
      setProfile(saved)
      setConfigResource(saved.configResource ?? "application.conf")
      setConfigFiles((saved.configFiles ?? []).join("\n"))
    }).catch((e) => setProfileMessage((e as Error).message))
  }, [])
  useEffect(() => {
    getDispatcherSettings().then((r) => setDispatcherValues(r.settings)).catch(() => setDispatcherValues({}))
  }, [liveSettings])

  async function saveProfile() {
    setBusy(true)
    setProfileMessage("")
    try {
      const saved = await saveEngineStartupProfile(overrides,
        configFiles.split(/\r?\n/).map((path) => path.trim()).filter(Boolean), configResource)
      setProfile(saved)
      setProfileMessage("Perfil salvo. Reinicie o engine para aplicar; a simulação atual continua com a configuração anterior.")
    } catch (e) {
      setProfileMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const liveKeys = useMemo(() => new Set(liveSettings.map((s) => s.key)), [liveSettings])
  const changedPaths = Object.keys(overrides)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (catalog ?? []).filter((d) => {
      if (scope === "changed" ? !(d.path in overrides) : scope !== "all" && d.scope !== scope) return false
      if (group && d.group !== group) return false
      return !q || `${d.path} ${d.env} ${d.description} ${d.context}`.toLowerCase().includes(q)
    })
  }, [catalog, query, scope, group, overrides])

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const counts = new Map<string, number>()
    for (const d of catalog ?? []) {
      if (scope === "changed" ? !(d.path in overrides) : scope !== "all" && d.scope !== scope) continue
      if (q && !`${d.path} ${d.env} ${d.description} ${d.context}`.toLowerCase().includes(q)) continue
      counts.set(d.group, (counts.get(d.group) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [catalog, query, scope, overrides])

  const set = useCallback((path: string, v: string | undefined) => {
    setOverrides((o) => {
      const next = { ...o }
      if (v === undefined) delete next[path]
      else next[path] = v
      return next
    })
    setLiveMsg(null)
  }, [])

  // Regenerated server-side so validation and formats live in one place (htc-locations).
  useEffect(() => {
    if (changedPaths.length === 0 && configResource === "application.conf") {
      setExported({ text: "" })
      return
    }
    const t = setTimeout(() => {
      exportEngineSettings(format, overrides, configResource)
        .then((r) => setExported({ text: r.text }))
        .catch((e) => setExported({ text: "", error: (e as Error).message }))
    }, 250)
    return () => clearTimeout(t)
  }, [format, overrides, changedPaths.length, configResource])

  const liveChanged = changedPaths.filter((p) => liveKeys.has(p))
  async function applyLive() {
    setBusy(true)
    setLiveMsg(null)
    try {
      await onApplyLive(Object.fromEntries(liveChanged.map((p) => [p, overrides[p]!])))
      setLiveMsg({ ok: true, text: `${liveChanged.length} setting(s) aplicadas ao engine em execução.` })
    } catch (e) {
      setLiveMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const fmt = FORMATS.find((f) => f.id === format)!
  const secrets = changedPaths.filter((p) => /password|secret|token/i.test(p))

  if (loadError) return <p className="text-xs text-destructive" role="alert">{translateText(loadError)}</p>
  if (!catalog) return <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />{translateText(" Lendo o application.conf…")}</p>

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[11px] text-muted-foreground">{translateText("Todas as chaves do ")}<code className="font-mono">application.conf</code>{translateText(" do engine (")}{translateText(catalog.length)}{translateText("), com o padrão do arquivo e a variável de ambiente quando existe. Só o que você altera entra na exportação.")}{" "}
        <span className="font-mono">{translateText(source)}</span>{translateText(". É o arquivo deste repositório; um engine remoto em outra versão pode diferir.")}</p>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => { setScope("all"); setQuery("dispatcher"); setGroup(""); setFormat("hocon") }}>{translateText("Dispatchers")}</Button>
        <input className={cn(input, "max-w-xs")} placeholder={translateText("Buscar chave, variável ou descrição…")} value={query} onChange={(e) => { setQuery(e.target.value); setGroup("") }} aria-label={translateText("Buscar")} />
        <div role="group" aria-label={translateText("Escopo")} className="inline-flex flex-wrap overflow-hidden rounded-sm border border-border text-xs">
          {SCOPES.map((sc, i) => (
            <button key={sc.id} type="button" onClick={() => { setScope(sc.id); setGroup("") }}
              className={cn(i > 0 && "border-l border-border", "px-2.5 py-1.5", scope === sc.id ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground")}>
              {translateText(sc.label)}
              {sc.id === "changed" && changedPaths.length > 0 && <span className="ml-1 rounded-sm bg-primary px-1 text-[9px] text-primary-foreground">{translateText(changedPaths.length)}</span>}
            </button>
          ))}
        </div>
      </div>

      <section className="flex flex-col gap-2 rounded-sm border border-border p-3" aria-label={translateText("Configuração de inicialização")}>
        <h3 className="text-sm font-semibold">{translateText("Configuração de inicialização")}</h3>
        <p className="text-[11px] text-muted-foreground">{translateText("Dispatchers e outras chaves do application.conf são aplicados quando o engine inicia. Salvar não altera a execução atual. Este perfil pertence à stack local desta API; para engines remotos, exporte o arquivo.")}</p>
        {profile?.configured ? <>
          <p className="break-all font-mono text-[10px] text-muted-foreground">{profile.path}</p>
          <label className="flex flex-col gap-1 text-xs">
            {translateText("Configuração base do engine")}
            <select className={cn(input, "font-mono")} value={configResource}
              onChange={(event) => setConfigResource(event.target.value)}>
              {(profile.configResources ?? ["application.conf", "beluga.conf", "beluga-multi.conf", "vm.conf", "kubernetes.conf"]).map((resource) =>
                <option key={resource} value={resource}>{resource}</option>)}
            </select>
          </label>
          <p className="text-[11px] text-muted-foreground">{translateText("Seleciona a configuração incluída no engine, equivalente a -Dconfig.resource. Não precisa de um caminho no servidor.")}</p>
          <label className="flex flex-col gap-1 text-xs">
            {translateText("Arquivos .conf adicionais")}
            <textarea className={cn(input, "h-24 py-2 font-mono")} value={configFiles}
              onChange={(event) => setConfigFiles(event.target.value)}
              placeholder="/etc/htc/threads.conf" />
          </label>
          <p className="text-[11px] text-muted-foreground">{translateText("Um caminho absoluto por linha, acessível pela API e pelo engine. Ordem: configuração base selecionada → arquivos listados → alterações abaixo. O último valor tem prioridade; includes e substituições HOCON são preservados. Reinicie o engine para aplicar.")}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={saveProfile} disabled={busy}><Save className="size-3.5" />{translateText("Salvar para o próximo reinício")}</Button>
            <Button size="sm" variant="outline" onClick={() => {
              setOverrides(profile.overrides)
              setConfigResource(profile.configResource ?? "application.conf")
              setConfigFiles((profile.configFiles ?? []).join("\n"))
            }}>{translateText("Carregar perfil salvo")}</Button>
          </div>
        </> : <p className="text-[11px] text-muted-foreground">{translateText("O salvamento de perfil não está habilitado nesta stack. Use a exportação HOCON abaixo ou configure HTC_ENGINE_PROFILE_FILE.")}</p>}
        {profileMessage && <p role="status" className="text-xs">{translateText(profileMessage)}</p>}
      </section>

      <div className="grid gap-4 lg:grid-cols-[14rem_1fr]">
        <nav aria-label={translateText("Grupos")} className="max-h-[28rem] overflow-y-auto rounded-sm border border-border text-xs">
          <button type="button" onClick={() => setGroup("")} className={cn("flex w-full justify-between px-3 py-1.5 text-left hover:bg-muted/50", !group && "bg-muted font-medium")}>{translateText("Todos os grupos ")}<span className="text-muted-foreground">{translateText(visible.length)}</span>
          </button>
          {groups.map(([g, n]) => (
            <button key={g} type="button" onClick={() => setGroup(g)} className={cn("flex w-full justify-between gap-2 border-t border-border px-3 py-1.5 text-left hover:bg-muted/50", group === g && "bg-muted font-medium")}>
              <span className="truncate font-mono text-[11px]">{translateText(g)}</span>
              <span className="text-muted-foreground">{translateText(n)}</span>
            </button>
          ))}
        </nav>

        <ul className="max-h-[28rem] divide-y divide-border overflow-y-auto rounded-sm border border-border">
          {visible.length === 0 && <li className="p-4 text-xs text-muted-foreground">{translateText("Nada encontrado com esses filtros.")}</li>}
          {visible.map((d) => {
            const edited = d.path in overrides
            return (
              <li key={d.path} className={cn("grid gap-2 px-3 py-2 text-xs sm:grid-cols-[1fr_14rem]", edited && "bg-primary/5")}>
                <div className="min-w-0">
                  <p className="break-all font-mono text-[11px] font-medium">{translateText(d.path)}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    {d.env ? <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[10px]">{d.env}</code> : <span className="text-[10px] text-muted-foreground">{translateText("sem variável: HOCON ou -D")}</span>}
                    {liveKeys.has(d.path) && <span className="rounded-sm bg-green-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-green-700 dark:text-green-400">{translateText("ao vivo")}</span>}
                    <span className="text-[10px] text-muted-foreground">{translateText("padrão: ")}<span className="font-mono">{translateText(d.default || "(vazio)")}</span></span>
                    {d.path in dispatcherValues && <span className="text-[10px] text-muted-foreground">{translateText("no engine: ")}<span className="font-mono">{dispatcherValues[d.path]}</span></span>}
                  </div>
                  {(d.description || d.context) && <p className="mt-1 text-[11px] text-muted-foreground">{translateText(d.description || d.context)}</p>}
                </div>
                <div className="flex items-start gap-1">
                  <Editor def={d} value={overrides[d.path]} onChange={(v) => set(d.path, v)} />
                  {edited && (
                    <Button size="xs" variant="ghost" onClick={() => set(d.path, undefined)} aria-label={translateText("Restaurar padrão de {0}", { 0: d.path })} title={translateText("Restaurar padrão")}>
                      <RotateCcw className="size-3" />
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      <section className="flex flex-col gap-3 border-t border-border pt-4" aria-label={translateText("Exportar")}>
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-sm font-semibold">{translateText("Exportar alterações")}</h3>
          <span className="text-[11px] text-muted-foreground">{changedPaths.length === 0 ? translateText("Nenhuma alteração: tudo no padrão do application.conf.") : translateText("{0} alteração(ões); o que for igual ao padrão não é exportado.", { 0: changedPaths.length })}</span>
          {changedPaths.length > 0 && <Button size="xs" variant="ghost" onClick={() => setOverrides({})}>{translateText("Limpar alterações")}</Button>}
        </div>
        <div role="group" aria-label={translateText("Formato")} className="inline-flex flex-wrap self-start overflow-hidden rounded-sm border border-border text-xs">
          {FORMATS.map((f, i) => (
            <button key={f.id} type="button" onClick={() => setFormat(f.id)} className={cn(i > 0 && "border-l border-border", "px-3 py-1.5", format === f.id ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground")}>{translateText(f.label)}</button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">{translateText(fmt.hint)}</p>
        {secrets.length > 0 && <p className="text-[11px] text-yellow-700 dark:text-yellow-400">{translateText("Atenção: ")}{translateText(secrets.join(", "))}{translateText(" parece guardar um segredo. A exportação o inclui em texto puro; prefira injetá-lo por um secret do ambiente.")}</p>}
        {exported.error && <p className="text-xs text-destructive" role="alert">{translateText(exported.error)}</p>}
        {exported.text && (
          <>
            <pre className="max-h-64 overflow-auto rounded-sm border border-border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">{exported.text}</pre>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard?.writeText(exported.text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }) }}>
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? translateText("Copiado") : translateText("Copiar")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => {
                const url = URL.createObjectURL(new Blob([exported.text + "\n"], { type: "text/plain" }))
                const a = document.createElement("a")
                a.href = url
                a.download = fmt.file
                a.click()
                URL.revokeObjectURL(url)
              }}>
                <Download className="size-3.5" />{translateText(" Baixar ")}{translateText(fmt.file)}
              </Button>
              {liveChanged.length > 0 && (
                <Button size="sm" onClick={applyLive} disabled={busy}>
                  {busy && <Loader2 className="size-3.5 animate-spin" />}{translateText(" Aplicar ")}{translateText(liveChanged.length)}{translateText(" ao vivo")}</Button>
              )}
              {liveMsg && <span role="status" className={cn("self-center text-xs", liveMsg.ok ? "text-green-600 dark:text-green-400" : "text-destructive")}>{translateText(liveMsg.text)}</span>}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
