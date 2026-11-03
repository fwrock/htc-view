"use client"

import { useI18n } from "@/components/i18n-provider"

import { useMemo } from "react"
import { cn } from "@workspace/ui/lib/utils"
import type { ActorSchema, FieldInfo, ScenarioActor } from "@/lib/simedape-api"

const input = "h-8 w-full rounded-sm border border-input bg-background px-2 text-xs focus:border-ring focus:ring-1 focus:ring-ring/30 focus:outline-none"

export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((cur, k) => (cur && typeof cur === "object" ? (cur as Record<string, unknown>)[k] : undefined), obj)
}
export function setPath<T>(obj: T, path: string, value: unknown): T {
  const [head, ...rest] = path.split(".")
  const o = { ...((obj ?? {}) as Record<string, unknown>) }
  o[head!] = rest.length ? setPath(o[head!], rest.join("."), value) : value
  return o as T
}
const jsonText = (v: unknown) => JSON.stringify(v ?? null, null, 1)

/** One field, rendered by its descriptor (type, enum, unit, ref, widget). */
function Field({ f, value, onChange }: { f: FieldInfo; value: unknown; onChange: (v: unknown) => void }) {
  const { t: translateText } = useI18n()

  const numeric = f.types.includes("number") || f.types.includes("integer")
  const body = (() => {
    if (!f.editable) return <pre className="max-h-24 overflow-auto rounded-sm bg-muted/40 p-2 font-mono text-[10px]">{jsonText(value)}</pre>
    if (f.enum && f.type !== "array") return (
      <select className={input} value={String(value ?? "")} onChange={(e) => onChange(typeof f.enum![0] === "number" ? Number(e.target.value) : e.target.value)}>
        {f.enum.map((o) => <option key={String(o)} value={String(o)}>{translateText(String(o))}</option>)}
      </select>
    )
    if (f.type === "boolean") return <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
    if (f.widget === "table" && f.items) {
      const rows = (Array.isArray(value) ? value : []) as Record<string, unknown>[]
      const blank = Object.fromEntries(f.items.map((c) => [c.name, c.enum ? c.enum[0] : c.nullable ? null : c.type === "number" || c.type === "integer" ? 0 : ""]))
      const setCell = (r: number, name: string, v: unknown) => onChange(rows.map((row, i) => (i === r ? { ...row, [name]: v } : row)))
      return (
        <div className="flex flex-col gap-1.5">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] font-normal text-muted-foreground">
                {f.items.map((c) => <th key={c.name} className="pr-2 pb-1 font-normal">{translateText(c.label)}{c.unit ? translateText(" ({0})", { 0: c.unit }) : translateText("")}{c.ref ? translateText(" · id de {0}", { 0: c.ref }) : translateText("")}</th>)}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {f.items!.map((c) => (
                    <td key={c.name} className="pr-2 pb-1">
                      {c.enum ? (
                        <select className={input} value={String(row[c.name] ?? "")} onChange={(e) => setCell(r, c.name, typeof c.enum![0] === "number" ? Number(e.target.value) : e.target.value)}>
                          {c.enum.map((o) => <option key={String(o)} value={String(o)}>{translateText(String(o))}</option>)}
                        </select>
                      ) : c.type === "number" || c.type === "integer" ? (
                        <input type="number" className={cn(input, "font-mono")} value={typeof row[c.name] === "number" ? (row[c.name] as number) : ""} placeholder={c.nullable ? translateText("—") : translateText("")}
                          step={c.type === "integer" ? 1 : "any"} onChange={(e) => setCell(r, c.name, e.target.value === "" ? (c.nullable ? null : 0) : Number(e.target.value))} />
                      ) : (
                        <input className={input} value={String(row[c.name] ?? "")} onChange={(e) => setCell(r, c.name, e.target.value)} />
                      )}
                    </td>
                  ))}
                  <td className="pb-1"><button type="button" className="px-1 text-destructive" aria-label={translateText("Remover linha")} onClick={() => onChange(rows.filter((_, i) => i !== r))}>{translateText("×")}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="self-start text-[11px] underline" onClick={() => onChange([...rows, { ...blank, ...(f.items!.some((c) => c.name === "laneId") ? { laneId: rows.length } : {}) }])}>{translateText("+ linha")}</button>
        </div>
      )
    }
    if (f.widget === "multiselect") return <span className="text-[11px] text-muted-foreground">{translateText((Array.isArray(value) ? value : []).join(", ") || "—")}{translateText(" — edite no JSON abaixo")}</span>
    if (f.widget === "ids") return (
      <input className={cn(input, "font-mono")} defaultValue={(Array.isArray(value) ? value : []).join(", ")} key={String(value)}
        onBlur={(e) => onChange(e.target.value.split(/[ ,;]+/).filter(Boolean).map(Number))} />
    )
    if (numeric) return (
      <span className="flex items-center gap-1.5">
        <input type="number" className={cn(input, "font-mono")} value={typeof value === "number" ? value : ""} step={f.types.includes("integer") ? 1 : "any"}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />
        {f.unit && <span className="shrink-0 text-[10px] text-muted-foreground">{translateText(f.unit)}</span>}
        {f.ref && <span className="shrink-0 rounded-sm bg-muted px-1 text-[10px]">{translateText("id de ")}{translateText(f.ref)}</span>}
      </span>
    )
    if (f.type === "string") return <input className={input} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
    return (
      <textarea className={cn(input, "h-20 font-mono")} defaultValue={jsonText(value)} key={jsonText(value)} spellCheck={false}
        onBlur={(e) => { try { onChange(JSON.parse(e.target.value)) } catch { /* keep the old value until the JSON is valid */ } }} />
    )
  })()
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium">{translateText(f.label)} <span className="font-mono text-[10px] font-normal text-muted-foreground">{translateText(f.path.replace("data.content.", ""))}</span></span>
      {translateText(body)}
      {f.help && <span className="text-[10px] text-muted-foreground">{translateText(f.help)}</span>}
    </label>
  )
}

/** Form generated from an actor descriptor: content fields grouped, runtime state read-only, dependencies listed. */
export function ActorForm({ actor, schema, catalog, onChange }: { actor: ScenarioActor; schema: ActorSchema; catalog: FieldInfo[]; onChange: (a: ScenarioActor) => void }) {
  const { t: translateText } = useI18n()

  const groups = useMemo(() => {
    const g = new Map<string, FieldInfo[]>()
    for (const f of catalog.filter((x) => x.editable)) g.set(f.group ?? "Outros", [...(g.get(f.group ?? "Outros") ?? []), f])
    return [...g.entries()]
  }, [catalog])
  const runtime = catalog.filter((f) => !f.editable)
  const deps = actor.dependencies ?? {}
  const declared = schema["x-htc-dependencies"]
  const optional = declared.filter((d) => d.name !== "*" && !d.required && !(d.name in deps))
  return (
    <div className="flex flex-col gap-4">
      {groups.map(([group, fields]) => (
        <fieldset key={group} className="rounded-sm border border-border p-3">
          <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{translateText(group)}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((f) => <Field key={f.path} f={f} value={getPath(actor, f.path)} onChange={(v) => onChange(setPath(actor, f.path, v))} />)}
          </div>
        </fieldset>
      ))}
      <fieldset className="rounded-sm border border-border p-3">
        <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{translateText("Dependências (propriedades de ligação)")}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {Object.entries(deps).map(([name, d]) => {
            const spec = declared.find((s) => s.name === name) ?? declared.find((s) => s.name === "*")
            return (
              <label key={name} className="flex flex-col gap-1 text-xs">
                <span className="font-medium">{translateText(name)} <span className="text-[10px] font-normal text-muted-foreground">→ {translateText(spec?.class ?? d.classType.split(".").pop())}{(d.relation ?? spec?.relation) === "part_of" ? translateText(" · parte de") : translateText("")}</span></span>
                <input type="number" className={cn(input, "font-mono")} value={d.id} onChange={(e) => onChange(setPath(actor, `dependencies.${name}.id`, Number(e.target.value)))} />
              </label>
            )
          })}
        </div>
        {optional.map((d) => (
          <button key={d.name} type="button" className="mt-2 mr-3 text-[11px] underline" onClick={() => onChange(setPath(actor, `dependencies.${d.name}`, { id: 0, classType: `hybrid.actor.${d.class}`, relation: d.relation }))}>
            + {translateText(d.name)} ({translateText(d.class)}{d.relation === "part_of" ? translateText(", parte de") : translateText("")})
          </button>
        ))}
      </fieldset>
      {runtime.length > 0 && (
        <details className="rounded-sm border border-border p-3 text-xs">
          <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{translateText("Estado de execução (somente leitura)")}</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">{runtime.map((f) => <Field key={f.path} f={f} value={getPath(actor, f.path)} onChange={() => {}} />)}</div>
        </details>
      )}
    </div>
  )
}

/** Paths (content fields and dependency ids) whose value differs between two versions of the same actor. */
export function diffActor(before: ScenarioActor, after: ScenarioActor, catalog: FieldInfo[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of catalog.filter((x) => x.editable)) {
    const a = getPath(before, f.path)
    const b = getPath(after, f.path)
    if (JSON.stringify(a) !== JSON.stringify(b)) out[f.path] = b
  }
  for (const [name, d] of Object.entries(after.dependencies ?? {})) {
    const prev = before.dependencies?.[name]
    if (!prev || prev.id !== d.id) out[`dependencies.${name}`] = d
  }
  return out
}

/** A new actor of a class with sensible defaults taken from its descriptor (the user then fills the form). */
export function defaultActor(schema: ActorSchema, catalog: FieldInfo[], id: number): ScenarioActor {
  let actor = {
    id,
    typeActor: schema["x-htc-class"],
    data: { dataType: schema.properties?.data?.properties?.dataType?.const ?? "", content: {} as Record<string, unknown> },
    dependencies: {} as Record<string, { id: number; classType: string; relation?: string }>,
  } as ScenarioActor
  for (const f of catalog.filter((x) => x.editable)) {
    let v: unknown
    if (f.enum) v = f.enum[0]
    else if (f.types.includes("integer") || f.types.includes("number")) v = f.exclusiveMinimum != null ? f.exclusiveMinimum + 1 : (f.minimum ?? 0)
    else if (f.type === "boolean") v = false
    else if (f.type === "string") v = ""
    else if (f.type === "array") v = []
    else if (f.type === "object") v = {}
    else v = null
    actor = setPath(actor, f.path, v)
  }
  for (const d of schema["x-htc-dependencies"]) {
    if (d.required && d.name !== "*") actor = setPath(actor, `dependencies.${d.name}`, { id: 0, classType: `hybrid.actor.${d.class}`, relation: d.relation })
  }
  return actor
}
