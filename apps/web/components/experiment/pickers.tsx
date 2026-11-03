"use client"

import { useI18n } from "@/components/i18n-provider"

import { useEffect, useMemo, useState } from "react"
import { Search } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { FolderPicker } from "@/components/locations/folder-picker"
import { getAllScenarios, getEngineSettings, listLocations, type EngineSettingDef, type SimLocation } from "@/lib/simedape-api"
import { INPUT } from "./fields"

/** `<location>:<scenario>` chosen from the registered locations, so nobody types it by hand. */
export function ScenarioPicker({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const { t: translateText } = useI18n()

  const [items, setItems] = useState<{ ref: string; title: string; kind: string }[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    getAllScenarios().then((r) => alive && setItems(r.scenarios.map((s) => ({ ref: s.ref, title: s.title || s.name, kind: s.location_kind }))))
      .catch((e) => alive && setError((e as Error).message))
    return () => { alive = false }
  }, [])
  const known = items?.some((i) => i.ref === value)
  return (
    <div className="flex flex-col gap-1">
      <select id={id} className={INPUT} value={known ? value : ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">{items === null && !error ? translateText("carregando…") : translateText("escolher um cenário…")}</option>
        {(items ?? []).map((i) => <option key={i.ref} value={i.ref}>{i.ref} — {translateText(i.title)}</option>)}
      </select>
      <input className={`${INPUT} font-mono`} aria-label={translateText("ou digite local:cenário")} placeholder={translateText("ou digite local:cenário")} value={value} onChange={(e) => onChange(e.target.value)} />
      {error && <p className="text-[10px] text-amber-700 dark:text-amber-400">{translateText("Não consegui listar os cenários (")}{translateText(error)}{translateText("). Cadastre locais na página Locais ou digite acima.")}</p>}
      {items && items.length === 0 && <p className="text-[10px] text-muted-foreground">{translateText("Nenhum cenário encontrado. Cadastre um local na página Locais.")}</p>}
    </div>
  )
}

/** A registered location of a given kind (e.g. the ClickHouse that holds the base). */
export function LocationPicker({ id, kind, value, onChange }: { id: string; kind?: string; value: string; onChange: (v: string) => void }) {
  const { t: translateText } = useI18n()

  const [locs, setLocs] = useState<SimLocation[] | null>(null)
  useEffect(() => {
    let alive = true
    listLocations().then((r) => alive && setLocs(r.locations.filter((l) => !kind || l.kind === kind))).catch(() => alive && setLocs([]))
    return () => { alive = false }
  }, [kind])
  return (
    <div className="flex flex-col gap-1">
      <select id={id} className={INPUT} value={locs?.some((l) => l.id === value) ? value : ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">{locs === null ? translateText("carregando…") : translateText("escolher um local…")}</option>
        {(locs ?? []).map((l) => <option key={l.id} value={l.id}>{l.id}{l.label ? translateText(" — {0}", { 0: l.label }) : translateText("")}</option>)}
      </select>
      <input className={`${INPUT} font-mono`} aria-label={translateText("ou digite o id do local")} placeholder={translateText("ou digite o id do local")} value={value} onChange={(e) => onChange(e.target.value)} />
      {locs && locs.length === 0 && <p className="text-[10px] text-muted-foreground">{translateText("Nenhum local ")}{translateText(kind ?? "")}{translateText(" cadastrado. Cadastre na página Locais.")}</p>}
    </div>
  )
}

/** A text input with a “browse” button that walks the folders of the machine where the API runs. */
export function PathInput({ id, value, onChange, placeholder, dir }: { id: string; value: string; onChange: (v: string) => void; placeholder?: string; dir?: boolean }) {
  const { t: translateText } = useI18n()

  const [open, setOpen] = useState(false)
  return (
    <div className="flex gap-2">
      <input id={id} className={`${INPUT} font-mono`} value={value} placeholder={translateText(placeholder)} onChange={(e) => onChange(e.target.value)} />
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>{dir ? translateText("Procurar pasta") : translateText("Procurar")}</Button>
      {open && <FolderPicker start={value.replace(/\/[^/]*$/, "") || undefined} onPick={(p) => { onChange(dir ? p : `${p}/${value.split("/").pop() ?? ""}`); setOpen(false) }} onClose={() => setOpen(false)} />}
    </div>
  )
}

/** Searchable catalogue of the engine's settings (read from application.conf): pick one instead of remembering its name. */
export function CatalogPicker({ mode, onPick, onClose }: { mode: "env" | "settings"; onPick: (key: string, value: string) => void; onClose: () => void }) {
  const { t: translateText } = useI18n()

  const [all, setAll] = useState<EngineSettingDef[] | null>(null)
  const [q, setQ] = useState("")
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    getEngineSettings().then((r) => alive && setAll(r.settings)).catch((e) => alive && setError((e as Error).message))
    return () => { alive = false }
  }, [])
  const { rows, total, matched } = useMemo(() => {
    const pool = (all ?? []).filter((s) => (mode === "env" ? s.env : true))
    const t = q.trim().toLowerCase()
    const hit = t ? pool.filter((s) => `${s.path} ${s.env} ${s.description} ${s.group}`.toLowerCase().includes(t)) : pool
    return { rows: hit.slice(0, 80), total: pool.length, matched: hit.length }
  }, [all, q, mode])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-label={translateText("Catálogo de configurações do engine")}>
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col gap-3 rounded-sm border border-border bg-card p-4 shadow-lg">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{mode === "env" ? translateText("Variáveis de ambiente do engine") : translateText("Chaves do application.conf")}</h2>
          <Button size="sm" variant="ghost" onClick={onClose}>{translateText("Fechar")}</Button>
        </div>
        <p className="text-[11px] text-muted-foreground">{translateText("Lido do application.conf do engine. Escolher adiciona a linha com o valor padrão; ajuste depois.")}</p>
        <div className="relative"><Search className="absolute left-2 top-2 size-3.5 text-muted-foreground" />
          <input autoFocus className={`${INPUT} pl-7`} placeholder={translateText("buscar por nome, descrição ou grupo (ex.: parquet, clickhouse, time)")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {error && <p className="text-xs text-destructive" role="alert">{translateText(error)}</p>}
        {!all && !error && <p className="text-xs text-muted-foreground">{translateText("Carregando…")}</p>}
        <ul className="min-h-40 flex-1 overflow-y-auto rounded-sm border border-border text-xs">
          {rows.map((s) => (
            <li key={s.path}>
              <button type="button" className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-muted/50" onClick={() => onPick(mode === "env" ? s.env : s.path, s.default.replace(/^"|"$/g, ""))}>
                <span className="font-mono">{mode === "env" ? translateText(s.env) : s.path} <span className="text-muted-foreground">= {translateText(s.default || "(vazio)")}</span></span>
                {mode === "env" && <span className="font-mono text-[10px] text-muted-foreground">{s.path}</span>}
                {(s.description || s.context) && <span className="text-[11px] text-muted-foreground">{translateText(s.description || s.context)}</span>}
              </button>
            </li>
          ))}
          {all && rows.length === 0 && <li className="px-3 py-2 text-muted-foreground">{translateText("Nada encontrado.")}</li>}
        </ul>
        {all && <p className="text-[10px] text-muted-foreground">{translateText("Mostrando ")}{rows.length}{translateText(" de ")}{matched}{translateText(" encontrados (")}{total}{translateText(" no catálogo")}{matched > rows.length ? translateText("). Refine a busca.") : translateText(").")}</p>}
      </div>
    </div>
  )
}
