"use client"

import { useI18n } from "@/components/i18n-provider"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { probeEngine } from "@/lib/htc-api"
import { FolderPicker } from "@/components/locations/folder-picker"
import {
  addEngine,
  addLocation,
  listEngines,
  removeEngine,
  type EngineKind,
  type SimEngine,
  getLocationScenarios,
  getLocationSimulations,
  getLocationSuggestions,
  type StoredSimulation,
  type LocationSuggestion,
  listLocations,
  removeLocation,
  testLocation,
  type LocationKind,
  type LocationRole,
  type LocationScenario,
  type SimLocation,
} from "@/lib/simedape-api"

const input = "h-8 rounded-sm border border-input bg-background px-2 text-xs"
const kinds: {
  id: LocationKind
  label: string
  hint: string
  pathExample: string
  pathHelp: string
}[] = [
  {
    id: "local",
    label: "Pasta local (sem Docker)",
    hint: "A API lê a pasta direto nesta máquina. Serve também para pastas já montadas (sshfs, gcsfuse, PVC).",
    pathExample: "<repositório>/hyperbolic-time-chamber/simulations/input",
    pathHelp: "Pasta que contém os cenários, cada um em <pasta>/<cenário>/simulation.json.",
  },
  {
    id: "docker",
    label: "Volume Docker",
    hint: "Monte a pasta na API e no engine antes de cadastrar o local. O cadastro não cria volumes Docker.",
    pathExample: "/scenarios",
    pathHelp: "Caminho que a API consegue ler. No Compose da plataforma, use /scenarios. Se a API roda no host, use o caminho no host.",
  },
  {
    id: "ssh",
    label: "Máquina remota (SSH)",
    hint: "VM ou servidor acessível por ssh sem senha (chave). Os cenários são baixados com rsync quando você os usa.",
    pathExample: "/srv/htc/simulations/input",
    pathHelp: "Pasta de cenários NA MÁQUINA REMOTA.",
  },
  {
    id: "clickhouse",
    label: "ClickHouse (resultados)",
    hint: "Banco onde o engine grava os eventos da simulação. Só para saída. A senha não é gravada aqui: informe o NOME de uma variável de ambiente do servidor da API.",
    pathExample: "",
    pathHelp: "",
  },
  {
    id: "gcs",
    label: "Google Cloud Storage",
    hint: "Bucket do GCS (por exemplo o usado pelo GKE). Requer gcloud instalado e autenticado (gcloud auth login).",
    pathExample: "gs://meu-bucket/simulations/input",
    pathHelp: "gs://BUCKET/PREFIXO onde ficam os cenários.",
  },
]

// Templates fill the form without saving a location or creating a mount.
type LocationTemplate = { label: string; loc: SimLocation; expectedScenario?: string }
const templates: LocationTemplate[] = [
  { label: "Docker Compose: Toulouse", expectedScenario: "tl_1pct_meso", loc: { id: "toulouse", kind: "docker", label: "Toulouse (Docker Compose)", path: "/scenarios", container_path: "/scenarios", role: "input" } },
  { label: "VM do GCP / servidor (SSH)", loc: { id: "vm-gcp", kind: "ssh", label: "VM do GCP", host: "", user: "", path: "/home/USUARIO/htc/simulations/input" } },
  { label: "Bucket GCS (GKE)", loc: { id: "gcs-gke", kind: "gcs", label: "GCS (GKE)", path: "gs://BUCKET/simulations/input" } },
]

const slug = (p?: string) =>
  ((p ?? "").replace(/\/+$/, "").split("/").pop() ?? "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)
const empty: SimLocation = { id: "", kind: "local", path: "", role: "input" }
const roleLabel = { input: "entrada", output: "saída", both: "entrada e saída" } as const
const fromSuggestion = (sug: LocationSuggestion): SimLocation => {
  // description/scenarios are display-only and must not reach the API.
  const { description: _d, scenarios: _s, ...loc } = sug
  void _d
  void _s
  return { ...loc, path: loc.path ?? "" }
}
const target = (l: SimLocation) =>
  l.kind === "clickhouse"
    ? `${l.secure ? "https" : "http"}://${l.host}:${l.port || (l.secure ? 8443 : 8123)}/${l.database}.${l.table}${l.password_env ? ` · senha: $${l.password_env}` : ""}`
    : `${l.host ? `${l.user ? l.user + "@" : ""}${l.host}:` : ""}${l.path}${l.container_path ? ` → ${l.container_path}` : ""}`

type Status = { ok: boolean; text: string }

export default function LocationsPage() {
  const { t: translateText } = useI18n()

  const [locations, setLocations] = useState<SimLocation[]>([])
  const [registry, setRegistry] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<SimLocation>(empty)
  const [status, setStatus] = useState<Record<string, Status>>({})
  const [scenarios, setScenarios] = useState<Record<string, LocationScenario[]>>({})
  const [sims, setSims] = useState<Record<string, StoredSimulation[]>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [picker, setPicker] = useState(false)
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([])
  const [engines, setEngines] = useState<SimEngine[]>([])
  const [engineStatus, setEngineStatus] = useState<Record<string, Status>>({})
  const [engineForm, setEngineForm] = useState<SimEngine>({ id: "", url: "", kind: "local" })

  const refreshEngines = useCallback(async () => {
    try {
      setEngines((await listEngines()).engines)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => {
    void refreshEngines()
  }, [refreshEngines])

  async function checkEngine(e: SimEngine) {
    setBusy(`engine-${e.id}`)
    const r = await probeEngine(e.url)
    setEngineStatus((st) => ({
      ...st,
      [e.id]: r.ok ? { ok: true, text: `online · simulação ${r.simulationStatus}` } : { ok: false, text: r.reason },
    }))
    setBusy(null)
  }
  async function saveEngine() {
    setBusy("engine-form")
    try {
      await addEngine(engineForm)
      setEngineForm({ id: "", url: "", kind: "local" })
      await refreshEngines()
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  async function dropEngine(id: string) {
    try {
      await removeEngine(id)
      await refreshEngines()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const refresh = useCallback(async () => {
    try {
      const data = await listLocations()
      setLocations(data.locations)
      setRegistry(data.registry)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])
  useEffect(() => {
    getLocationSuggestions().then((r) => setSuggestions(r.suggestions)).catch(() => setSuggestions([]))
  }, [locations])

  async function check(loc: SimLocation) {
    const id = loc.id
    setBusy(id)
    try {
      const r = await testLocation(id)
      setStatus((s) => ({ ...s, [id]: { ok: r.ok, text: r.ok ? (r.status ?? "ok") : (r.error ?? "falhou") } }))
      if (r.ok && loc.kind === "clickhouse") {
        const list = await getLocationSimulations(id)
        setSims((s) => ({ ...s, [id]: list.simulations }))
      } else if (r.ok && loc.role !== "output") {
        const list = await getLocationScenarios(id)
        setScenarios((s) => ({ ...s, [id]: list.scenarios }))
        setStatus((s) => ({ ...s, [id]: { ok: true, text: translateText("Pasta legível · {0} cenário(s)", { 0: list.scenarios.length }) } }))
      }
    } catch (e) {
      setStatus((s) => ({ ...s, [id]: { ok: false, text: (e as Error).message } }))
    } finally {
      setBusy(null)
    }
  }

  async function useTemplate(template: LocationTemplate) {
    if (!template.expectedScenario) {
      setForm({ ...template.loc })
      return
    }
    setBusy(`example-${template.loc.id}`)
    try {
      // The Compose example reads the same /scenarios mount as the environment location.
      const { scenarios: mountedScenarios } = await getLocationScenarios("default")
      if (!mountedScenarios.some((scenario) => scenario.name === template.expectedScenario)) {
        setError(translateText("O volume atual em /scenarios não contém {0}. Defina HTC_SCENARIOS_HOST_DIR=/home/dean/hyperbolic-time-chamber/simulations/input no .env da plataforma e execute docker compose up -d antes de usar este exemplo. Cadastrar um local não altera o volume.", { 0: template.expectedScenario }))
        return
      }
      setForm({ ...template.loc })
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function save() {
    setBusy("form")
    try {
      await addLocation({ ...form, role: form.kind === "clickhouse" ? "output" : (form.role ?? "input"), id: form.id || slug(form.path) || slug(form.database ?? "") })
      setForm(empty)
      await refresh()
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function remove(id: string) {
    try {
      await removeLocation(id)
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const set = (patch: Partial<SimLocation>) => setForm((f) => ({ ...f, ...patch }))
  const kind = kinds.find((k) => k.id === form.kind)
  const hint = kind?.hint

  function renderSection(title: string, subtitle: string, items: SimLocation[]) {
    return (
      <section aria-label={translateText("Locais de {0}", { 0: title.toLowerCase() })} className="rounded-sm border border-border bg-card">
        <div className="border-b border-border px-4 py-2">
          <h2 className="text-sm font-semibold">{translateText(title)}</h2>
          <p className="text-[11px] text-muted-foreground">{translateText(subtitle)}</p>
        </div>
        {items.length === 0 ? (
          <p className="p-4 text-xs text-muted-foreground">{translateText("Nenhum local de ")}{translateText(title.toLowerCase())}{translateText(" configurado. Adicione um abaixo.")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((l) => {
              const st = status[l.id]
              const list = scenarios[l.id]
              const stored = sims[l.id]
              return (
                <li key={`${title}-${l.id}`} className="flex flex-col gap-2 px-4 py-3 text-xs">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-semibold">{translateText(l.label || l.id)}</span>
                    <span className="rounded-sm border border-border bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-widest">{translateText(l.kind)}</span>
                    {l.role === "both" && <span className="text-[10px] text-muted-foreground">{translateText(roleLabel.both)}</span>}
                    <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{translateText(target(l))}</span>
                    {st && (
                      <span className={st.ok ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                        {st.ok ? translateText("✓ {0}", { 0: st.text }) : translateText("✕ {0}", { 0: st.text.slice(0, 160) })}
                      </span>
                    )}
                    <Button size="sm" variant="outline" disabled={busy === l.id} onClick={() => check(l)}>
                      {busy === l.id ? translateText("Testando…") : l.kind === "clickhouse" ? translateText("Testar e listar simulações") : l.role === "output" ? translateText("Testar") : translateText("Testar e listar")}
                    </Button>
                    {l.id !== "default" && (
                      <Button size="sm" variant="ghost" onClick={() => remove(l.id)}>{translateText("Remover")}</Button>
                    )}
                  </div>
                  {title === "Entrada" && list && (
                    <ul className="ml-1 grid gap-1 text-[11px] text-muted-foreground sm:grid-cols-2">
                      {list.length === 0 && <li>{translateText("Nenhum cenário encontrado (esperado: <pasta>/<cenário>/simulation.json).")}</li>}
                      {list.map((sc) => (
                        <li key={sc.ref}>
                          <span className="font-medium text-foreground">{translateText(sc.name)}</span> · {translateText(sc.format)}
                          {sc.map_mode === "osm" ? translateText(" · OSM") : translateText("")}
                          {sc.duration != null ? translateText(" · {0}s", { 0: sc.duration }) : translateText("")}
                        </li>
                      ))}
                    </ul>
                  )}
                  {title === "Saída" && stored && (
                    <ul className="ml-1 grid gap-1 text-[11px] text-muted-foreground sm:grid-cols-2">
                      {stored.length === 0 && <li>{translateText("Nenhuma simulação gravada ainda.")}</li>}
                      {stored.map((sm) => (
                        <li key={sm.simulation_id}>
                          <span className="font-medium text-foreground">{translateText(sm.simulation_id)}</span> · {translateText(sm.links)}{translateText(" links · ")}{translateText(sm.events)}{translateText(" eventos")}</li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{translateText("Locais de simulação")}</h1>
        <p className="mt-1 text-xs text-muted-foreground">{translateText("Configure uma vez de onde vêm os cenários (entrada) e para onde vão os resultados (saída). Todas as etapas escolhem a partir daqui.")}{registry && <>{translateText(" Arquivo: ")}<code className="font-mono">{registry}</code></>}
        </p>
      </div>

      {error && (
        <div className="rounded-sm border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
          {translateText(error)}
        </div>
      )}

      {translateText(renderSection("Entrada", "De onde vêm os cenários que você executa.", locations.filter((l) => l.role !== "output")))}
      {translateText(renderSection("Saída", "Para onde vão os resultados (pastas de relatórios e bancos como o ClickHouse).", locations.filter((l) => l.role === "output" || l.role === "both")))}

      <section aria-label={translateText("Engines")} className="rounded-sm border border-border bg-card">
        <div className="border-b border-border px-4 py-2">
          <h2 className="text-sm font-semibold">{translateText("Engines")}</h2>
          <p className="text-[11px] text-muted-foreground">{translateText("Engines HTC em execução que a página Simulador controla (API REST). Em cluster (multinode), cadastre ")}<b>{translateText("um")}</b>{translateText(" endpoint de controle: o serviço ou nó que expõe a API.")}</p>
        </div>
        <ul className="divide-y divide-border">
          {engines.map((e) => {
            const st = engineStatus[e.id]
            return (
              <li key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-xs">
                <span className="font-semibold">{translateText(e.label || e.id)}</span>
                <span className="rounded-sm border border-border bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-widest">{translateText(e.kind ?? "local")}</span>
                {e.nodes ? <span className="text-[10px] text-muted-foreground">{translateText(e.nodes)}{translateText(" nós")}</span> : null}
                <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
                  {translateText(e.url)}{e.location ? translateText(" · cenários: {0}", { 0: e.location }) : translateText("")}
                </span>
                {st && <span className={st.ok ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>{st.ok ? translateText("✓ {0}", { 0: st.text }) : translateText("✕ {0}", { 0: st.text })}</span>}
                <Button size="sm" variant="outline" disabled={busy === `engine-${e.id}`} onClick={() => checkEngine(e)}>
                  {busy === `engine-${e.id}` ? translateText("Testando…") : translateText("Testar")}
                </Button>
                {e.id !== "default" && <Button size="sm" variant="ghost" onClick={() => dropEngine(e.id)}>{translateText("Remover")}</Button>}
              </li>
            )
          })}
        </ul>
        <div className="flex flex-col gap-3 border-t border-border p-4">
          <p className="text-[11px] font-medium">{translateText("Adicionar engine")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs">{translateText("Identificador")}<input className={input} placeholder={translateText("ex.: docker-local, gke-prod")} value={engineForm.id} onChange={(e) => setEngineForm({ ...engineForm, id: e.target.value.toLowerCase() })} />
            </label>
            <label className="flex flex-col gap-1 text-xs">{translateText("Tipo")}<select className={input} value={engineForm.kind ?? "local"} onChange={(e) => setEngineForm({ ...engineForm, kind: e.target.value as EngineKind })}>
                <option value="local">{translateText("Local (sem Docker)")}</option>
                <option value="docker">{translateText("Docker")}</option>
                <option value="vm">{translateText("VM")}</option>
                <option value="gke">{translateText("GKE / cluster")}</option>
                <option value="other">{translateText("Outro")}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs sm:col-span-2">{translateText("Endereço da API")}<input className={input} placeholder={translateText("http://localhost:9804/api/v1")} value={engineForm.url} onChange={(e) => setEngineForm({ ...engineForm, url: e.target.value })} />
              <span className="text-[11px] text-muted-foreground">{translateText("Como o seu ")}<b>{translateText("navegador")}</b>{translateText(" alcança a API do engine (HTC_API_ENABLED=true, porta HTC_API_PORT). Para GKE/VM privados use um port-forward ou túnel, ex.: ")}<code className="font-mono">kubectl port-forward svc/htc 9804:9804</code>.</span>
            </label>
            <label className="flex flex-col gap-1 text-xs">{translateText("Local de cenários (opcional)")}<select className={input} value={engineForm.location ?? ""} onChange={(e) => setEngineForm({ ...engineForm, location: e.target.value })}>
                <option value="">{translateText("Qualquer local de entrada")}</option>
                {locations.filter((l) => l.role !== "output" && l.kind !== "clickhouse").map((l) => <option key={l.id} value={l.id}>{translateText(l.label || l.id)}</option>)}
              </select>
              <span className="text-[11px] text-muted-foreground">{translateText("Restringe o seletor do Simulador aos cenários que este engine enxerga.")}</span>
            </label>
            <label className="flex flex-col gap-1 text-xs">{translateText("Nós (opcional)")}<input className={input} type="number" min={0} placeholder={translateText("ex.: 16")} value={engineForm.nodes || ""} onChange={(e) => setEngineForm({ ...engineForm, nodes: Number(e.target.value) || 0 })} />
              <span className="text-[11px] text-muted-foreground">{translateText("Só informativo: tamanho do cluster atrás do endpoint.")}</span>
            </label>
          </div>
          <div><Button size="sm" disabled={busy === "engine-form" || !engineForm.id || !engineForm.url} onClick={saveEngine}>{translateText("Adicionar engine")}</Button></div>
        </div>
      </section>

      <section aria-label={translateText("Adicionar local")} className="flex flex-col gap-4 rounded-sm border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">{translateText("Adicionar local")}</h2>

        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-medium">{translateText("Atalhos (preenchem o formulário; revise e clique em Adicionar)")}</p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((sug) => (
              <Button key={sug.id} size="sm" variant="outline" type="button" title={translateText(sug.description)}
                onClick={() => setForm(fromSuggestion(sug))}>
                {translateText(sug.label)}
              </Button>
            ))}
            {templates.map((t) => (
              <Button key={t.label} size="sm" variant="ghost" type="button" disabled={busy === `example-${t.loc.id}`} onClick={() => void useTemplate(t)}>
                {translateText(t.label)}{translateText(" (modelo)")}</Button>
            ))}
          </div>
          {suggestions.map((sug) => (
            <p key={sug.id} className="text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">{translateText(sug.label)}:</span> {translateText(sug.description)}.
            </p>
          ))}
          <details className="rounded-sm border border-border bg-muted/30 p-3 text-xs">
            <summary className="cursor-pointer font-medium">{translateText("Exemplo: tl_1pct_meso no Docker Compose")}</summary>
            <ol className="mt-3 list-decimal space-y-3 pl-5 text-muted-foreground">
              <li>
                <p>{translateText("Na raiz da plataforma, defina a pasta de cenários no arquivo .env e recrie os containers:")}</p>
                <pre className="mt-2 overflow-x-auto rounded-sm bg-background p-2 font-mono text-[11px] text-foreground">{"# .env\nHTC_SCENARIOS_HOST_DIR=/home/dean/hyperbolic-time-chamber/simulations/input\n\n# terminal\ndocker compose up -d"}</pre>
                <p className="mt-2 break-all"><span className="font-medium">{translateText("Pasta no host:")}</span>{" "}<code>/home/dean/hyperbolic-time-chamber/simulations/input</code></p>
                <p><span className="font-medium">{translateText("Pasta na API e no engine:")}</span>{" "}<code>/scenarios</code></p>
                <p className="mt-1">{translateText("O Compose também monta a pasta em /app/hyperbolic-time-chamber/simulations/input para os caminhos absolutos deste cenário.")}</p>
              </li>
              <li>{translateText("O atalho Docker Compose: Toulouse verifica se tl_1pct_meso está montado antes de preencher o formulário. Depois clique em Adicionar. Os dois caminhos devem ser /scenarios.")}</li>
              <li>{translateText("Use Testar e listar. No Simulador, selecione tl_1pct_meso do local Toulouse (Docker Compose) e clique em Iniciar.")}</li>
            </ol>
            <p className="mt-3 break-all text-muted-foreground">{translateText("Arquivo do cenário no host:")}{" "}<code>/home/dean/hyperbolic-time-chamber/simulations/input/tl_1pct_meso/simulation.json</code></p>
          </details>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs">{translateText("Tipo")}<select className={input} value={form.kind} onChange={(e) => { const k = e.target.value as LocationKind; set({ kind: k, role: k === "clickhouse" ? "output" : form.role === "output" ? "output" : (form.role ?? "input") }) }}>
              {kinds.map((k) => <option key={k.id} value={k.id}>{translateText(k.label)}</option>)}
            </select>
            <span className="text-[11px] text-muted-foreground">{translateText(hint)}</span>
          </label>
          {form.kind !== "clickhouse" && (
            <label className="flex flex-col gap-1 text-xs">{translateText("Uso")}<select className={input} value={form.role ?? "input"} onChange={(e) => set({ role: e.target.value as LocationRole })}>
                <option value="input">{translateText("Entrada: cenários que você executa")}</option>
                <option value="output">{translateText("Saída: onde os resultados são gravados")}</option>
                <option value="both">{translateText("Entrada e saída")}</option>
              </select>
              <span className="text-[11px] text-muted-foreground">{translateText("Uma pasta de saída precisa ser gravável. Use “Entrada e saída” se a mesma pasta serve aos dois.")}</span>
            </label>
          )}
          <label className="flex flex-col gap-1 text-xs">{translateText("Identificador")}<input className={input} placeholder={translateText(slug(form.path) || "ex.: repo, vm-gcp")} value={form.id} onChange={(e) => set({ id: e.target.value.toLowerCase() })} />
            <span className="text-[11px] text-muted-foreground">{translateText("Nome curto (a-z, 0-9, -). Aparece nos seletores como ")}<code className="font-mono">{form.id || slug(form.path) || "id"}:cenário</code>{translateText(". Se vazio, usa o nome da pasta.")}</span>
          </label>
          <label className="flex flex-col gap-1 text-xs">{translateText("Nome (opcional)")}<input className={input} placeholder={translateText("ex.: Cenários do repositório")} value={form.label ?? ""} onChange={(e) => set({ label: e.target.value })} />
            <span className="text-[11px] text-muted-foreground">{translateText("Rótulo legível mostrado nas listas.")}</span>
          </label>
          {form.kind === "ssh" && (
            <>
              <label className="flex flex-col gap-1 text-xs">{translateText("Host")}<input className={input} placeholder={translateText("ex.: 34.12.56.78 ou minha-vm")} value={form.host ?? ""} onChange={(e) => set({ host: e.target.value })} />
                <span className="text-[11px] text-muted-foreground">{translateText("O mesmo endereço que você usa em ")}<code className="font-mono">ssh USUARIO@HOST</code>{translateText(" (IP da VM ou nome do ~/.ssh/config).")}</span>
              </label>
              <label className="flex flex-col gap-1 text-xs">{translateText("Usuário")}<input className={input} placeholder={translateText("ex.: dean")} value={form.user ?? ""} onChange={(e) => set({ user: e.target.value })} />
                <span className="text-[11px] text-muted-foreground">{translateText("Opcional se já estiver no ~/.ssh/config.")}</span>
              </label>
            </>
          )}
          {form.kind === "clickhouse" && (
            <>
              <label className="flex flex-col gap-1 text-xs">{translateText("Host")}<input className={input} placeholder={translateText("ex.: localhost ou clickhouse.minha-vm")} value={form.host ?? ""} onChange={(e) => set({ host: e.target.value })} />
                <span className="text-[11px] text-muted-foreground">{translateText("Endereço do servidor (interface HTTP).")}</span>
              </label>
              <label className="flex flex-col gap-1 text-xs">{translateText("Porta")}<input className={input} type="number" placeholder={translateText("8123 (8443 com HTTPS)")} value={form.port || ""} onChange={(e) => set({ port: Number(e.target.value) || 0 })} />
                <span className="text-[11px] text-muted-foreground">{translateText("Porta HTTP, não a nativa (9000).")}</span>
              </label>
              <label className="flex flex-col gap-1 text-xs">{translateText("Banco (database)")}<input className={input} placeholder={translateText("ex.: htc")} value={form.database ?? ""} onChange={(e) => set({ database: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1 text-xs">{translateText("Tabela")}<input className={input} placeholder={translateText("ex.: vehicle_link_events")} value={form.table ?? ""} onChange={(e) => set({ table: e.target.value })} />
                <span className="text-[11px] text-muted-foreground">{translateText("O engine grava eventos em vehicle_link_events.")}</span>
              </label>
              <label className="flex flex-col gap-1 text-xs">{translateText("Usuário")}<input className={input} placeholder={translateText("ex.: default")} value={form.user ?? ""} onChange={(e) => set({ user: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1 text-xs">{translateText("Variável da senha (opcional)")}<input className={input} placeholder={translateText("ex.: HTC_CLICKHOUSE_PASSWORD")} value={form.password_env ?? ""} onChange={(e) => set({ password_env: e.target.value.toUpperCase() })} />
                <span className="text-[11px] text-muted-foreground">{translateText("Nome de uma variável de ambiente definida onde a API roda. A senha em si nunca é gravada. Deixe vazio se o banco não tem senha (caso do docker-compose.yml).")}</span>
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={!!form.secure} onChange={(e) => set({ secure: e.target.checked })} />{translateText("Usar HTTPS")}</label>
            </>
          )}
          {form.kind !== "clickhouse" && <label className="flex flex-col gap-1 text-xs sm:col-span-2">{form.kind === "docker" ? translateText("Caminho acessível pela API") : form.kind === "gcs" ? translateText("Caminho gs://") : translateText("Caminho")}
            <span className="flex gap-2">
              <input className={`${input} flex-1`} placeholder={translateText("ex.: {0}", { 0: kind?.pathExample ?? "" })} value={form.path} onChange={(e) => set({ path: e.target.value })} />
              {(form.kind === "local" || form.kind === "docker") && (
                <Button size="sm" variant="outline" type="button" onClick={() => setPicker(true)}>{translateText("Procurar…")}</Button>
              )}
            </span>
            <span className="text-[11px] text-muted-foreground">{translateText(kind?.pathHelp)} {form.role === "output" ? "Pasta gravável onde os relatórios serão gravados." : <>{translateText("Estrutura esperada: ")}<code className="font-mono">&lt;caminho&gt;/&lt;cenário&gt;/simulation.json</code>.</>}</span>
          </label>}
          {form.kind !== "clickhouse" && (
            <label className="flex flex-col gap-1 text-xs sm:col-span-2">
              {form.kind === "docker" ? translateText("Caminho no container") : translateText("Caminho visto pelo engine (opcional)")}
              <input className={input} placeholder={form.kind === "docker" ? "/scenarios" : translateText("ex.: /app/hyperbolic-time-chamber/simulations/input")} value={form.container_path ?? ""} onChange={(e) => set({ container_path: e.target.value })} />
              <span className="text-[11px] text-muted-foreground">
                {form.kind === "docker"
                  ? translateText("Onde o engine enxerga a pasta. No Compose da plataforma, use /scenarios; se a API roda fora do Docker, o caminho acima pode ser diferente.")
                  : <>{translateText("Onde o engine enxerga esta pasta. Em ")}<b>{translateText("multinode")}</b>{translateText(" (GKE/VM) todos os nós precisam ver o cenário no ")}<b>{translateText("mesmo caminho")}</b>{translateText(": informe o ponto de montagem compartilhado (por exemplo o gcsfuse do bucket em cada pod, ")}<code className="font-mono">/app/hyperbolic-time-chamber/simulations/input</code>{translateText("). Sem isso não é possível iniciar o cenário pelo caminho.")}</>}
              </span>
            </label>
          )}
        </div>
        <div>
          <Button size="sm" disabled={busy === "form" || (form.kind === "clickhouse" ? !form.host || !form.database || !form.table : !form.path || (!form.id && !slug(form.path)))} onClick={save}>{translateText("Adicionar")}</Button>
        </div>
      </section>
      {picker && (
        <FolderPicker
          start={form.path}
          onClose={() => setPicker(false)}
          onPick={(path) => {
            set({ path })
            setPicker(false)
          }}
        />
      )}
    </div>
  )
}
