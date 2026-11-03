"use client"

import { useI18n } from "@/components/i18n-provider"

import { useState } from "react"
import { Plus, X } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import type { Json, SchemaProp } from "@/lib/experiment-api"

export const INPUT = "h-8 w-full rounded-sm border border-input bg-background px-2 text-xs"
export const AREA = "w-full rounded-sm border border-input bg-background px-2 py-1.5 font-mono text-[11px]"
export const LABEL = "text-[11px] font-medium text-muted-foreground"

const show = (v: Json | undefined) => (v === undefined ? "" : JSON.stringify(v, null, 1))

/** A JSON value edited as text: invalid text is kept (and flagged) instead of being lost while typing. */
export function JsonField({ value, onChange, rows = 3 }: { value: Json | undefined; onChange: (v: Json | undefined) => void; rows?: number }) {
  const { t: translateText } = useI18n()

  const [text, setText] = useState(show(value))
  const [error, setError] = useState<string | null>(null)
  const [seen, setSeen] = useState(JSON.stringify(value))
  // Another editor (e.g. the JSON tab) changed the value: show it, unless the user is mid-edit on invalid text.
  if (JSON.stringify(value) !== seen) {
    setSeen(JSON.stringify(value))
    if (!error) setText(show(value))
  }
  return (
    <div>
      <textarea className={AREA} rows={rows} value={text} spellCheck={false} aria-invalid={!!error}
        onChange={(e) => {
          const t = e.target.value
          setText(t)
          if (t.trim() === "") { setError(null); setSeen("undefined"); onChange(undefined); return }
          try {
            const parsed = JSON.parse(t) as Json
            setError(null); setSeen(JSON.stringify(parsed)); onChange(parsed)
          } catch (err) { setError((err as Error).message) }
        }} />
      {error && <p className="text-[10px] text-destructive" role="alert">{translateText("JSON inválido: ")}{translateText(error)}</p>}
    </div>
  )
}

/** One field generated from its JSON-Schema-like spec. */
export function Field({ name, spec, value, onChange, required, id, help, control: custom }: {
  name: string; spec: SchemaProp; value: Json | undefined; onChange: (v: Json | undefined) => void; required?: boolean; id: string
  help?: { example?: string; hint?: string }; control?: React.ReactNode
}) {
  const { t: translateText } = useI18n()

  const type = spec.type
  const enumValues = spec.enum ?? spec.items?.enum
  let control: React.ReactNode
  if (type === "boolean") {
    control = <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
  } else if (type === "array" && enumValues) {
    const cur = Array.isArray(value) ? value : []
    control = (
      <div className="flex flex-wrap gap-3" role="group" aria-labelledby={`${id}-l`}>
        {enumValues.map((o) => (
          <label key={String(o)} className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={cur.includes(o)} onChange={(e) => {
              const next = e.target.checked ? [...cur, o] : cur.filter((x) => x !== o)
              onChange(next.length ? next : undefined)
            }} /> {String(o)}
          </label>
        ))}
      </div>
    )
  } else if (enumValues && type !== "array") {
    control = (
      <select id={id} className={INPUT} value={value === undefined ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}>
        <option value="">{spec.default !== undefined ? translateText("(padrão: {0})", { 0: String(spec.default) }) : translateText("—")}</option>
        {enumValues.map((o) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
      </select>
    )
  } else if (type === "integer" || type === "number") {
    control = (
      <input id={id} className={INPUT} type="number" min={spec.minimum} max={spec.maximum} step={type === "integer" ? 1 : "any"}
        placeholder={spec.default !== undefined ? translateText("padrão {0}", { 0: String(spec.default) }) : translateText("")} value={typeof value === "number" ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />
    )
  } else if (type === "string") {
    control = (
      <input id={id} className={INPUT} placeholder={spec.default !== undefined ? translateText("padrão {0}", { 0: String(spec.default) }) : translateText("")}
        value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)} />
    )
  } else {
    control = <JsonField value={value} onChange={onChange} rows={type === "object" || type === "array" ? 3 : 2} />
  }
  if (custom) control = custom
  return (
    <div className="flex flex-col gap-1">
      <label id={`${id}-l`} htmlFor={id} className={LABEL}>
        <span className="font-mono">{translateText(name)}</span>{required && <span className="text-destructive"> *</span>}
        {spec.description && <span className="ml-1 font-normal">— {translateText(spec.description)}</span>}
      </label>
      {translateText(control)}
      {help?.hint && <p className="text-[11px] leading-snug text-muted-foreground">{translateText(help.hint)}</p>}
      {help?.example && <p className="text-[10px] text-muted-foreground">{translateText("ex.: ")}<span className="font-mono">{translateText(help.example)}</span></p>}
    </div>
  )
}

/** name -> JSON value rows (variables, env, settings, locations). */
export function KeyValueEditor({ value, onChange, keyLabel = "nome", addLabel = "Adicionar", asString = false }: {
  value: Record<string, Json> | undefined; onChange: (v: Record<string, Json> | undefined) => void
  keyLabel?: string; addLabel?: string; asString?: boolean
}) {
  const { t: translateText } = useI18n()

  const entries = Object.entries(value ?? {})
  const commit = (next: [string, Json][]) => onChange(next.length ? Object.fromEntries(next) : undefined)
  return (
    <div className="flex flex-col gap-1.5">
      {entries.map(([k, v], i) => (
        <div key={i} className="flex items-start gap-2">
          <input className={`${INPUT} max-w-52 font-mono`} aria-label={translateText(keyLabel)} value={k}
            onChange={(e) => commit(entries.map((x, j) => (j === i ? [e.target.value, x[1]] : x)))} />
          <div className="flex-1">
            {asString
              ? <input className={`${INPUT} font-mono`} aria-label={translateText("valor de {0}", { 0: k })} value={String(v ?? "")}
                  onChange={(e) => commit(entries.map((x, j) => (j === i ? [x[0], e.target.value] : x)))} />
              : <JsonField value={v} rows={1} onChange={(nv) => commit(entries.map((x, j) => (j === i ? [x[0], nv ?? null] : x)))} />}
          </div>
          <Button type="button" size="sm" variant="ghost" aria-label={translateText("Remover {0}", { 0: k })} onClick={() => commit(entries.filter((_, j) => j !== i))}><X className="size-3.5" /></Button>
        </div>
      ))}
      <div><Button type="button" size="sm" variant="outline" onClick={() => commit([...entries, [`novo${entries.length + 1}`, asString ? "" : ""]])}><Plus className="size-3.5" /> {translateText(addLabel)}</Button></div>
    </div>
  )
}

/** Matrix axes: name -> list of values, typed as comma-separated JSON values (5, 10, "a"). */
export function MatrixEditor({ value, onChange }: { value: Record<string, Json[]> | undefined; onChange: (v: Record<string, Json[]> | undefined) => void }) {
  const { t: translateText } = useI18n()

  const entries = Object.entries(value ?? {})
  const commit = (next: [string, Json[]][]) => onChange(next.length ? Object.fromEntries(next) : undefined)
  const toText = (vs: Json[]) => vs.map((x) => JSON.stringify(x)).join(", ")
  return (
    <div className="flex flex-col gap-1.5">
      {entries.map(([k, vs], i) => <MatrixRow key={i} name={k} values={vs} text={toText(vs)}
        onName={(n) => commit(entries.map((x, j) => (j === i ? [n, x[1]] : x)))}
        onValues={(v) => commit(entries.map((x, j) => (j === i ? [x[0], v] : x)))}
        onRemove={() => commit(entries.filter((_, j) => j !== i))} />)}
      <div><Button type="button" size="sm" variant="outline" onClick={() => commit([...entries, [`eixo${entries.length + 1}`, [1]]])}><Plus className="size-3.5" />{translateText(" Adicionar eixo")}</Button></div>
    </div>
  )
}

function MatrixRow({ name, values, text, onName, onValues, onRemove }: {
  name: string; values: Json[]; text: string; onName: (n: string) => void; onValues: (v: Json[]) => void; onRemove: () => void
}) {
  const { t: translateText } = useI18n()

  const [draft, setDraft] = useState(text)
  const [error, setError] = useState(false)
  const [seen, setSeen] = useState(JSON.stringify(values))
  if (JSON.stringify(values) !== seen) {
    setSeen(JSON.stringify(values))
    if (!error) setDraft(text)
  }
  return (
    <div className="flex items-start gap-2">
      <input className={`${INPUT} max-w-40 font-mono`} aria-label={translateText("eixo")} value={name} onChange={(e) => onName(e.target.value)} />
      <div className="flex-1">
        <input className={`${INPUT} font-mono`} aria-label={translateText("valores de {0}", { 0: name })} aria-invalid={error} value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            try {
              const parsed = JSON.parse(`[${e.target.value}]`) as Json[]
              setError(false); setSeen(JSON.stringify(parsed)); onValues(parsed)
            } catch { setError(true) }
          }} />
        {error && <p className="text-[10px] text-destructive" role="alert">{translateText("Use valores JSON separados por vírgula: 5, 10, 20 ou \"a\", \"b\".")}</p>}
      </div>
      <Button type="button" size="sm" variant="ghost" aria-label={translateText("Remover eixo {0}", { 0: name })} onClick={onRemove}><X className="size-3.5" /></Button>
    </div>
  )
}
