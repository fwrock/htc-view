"use client"

import { useI18n } from "@/components/i18n-provider"

import { Suspense, useState } from "react"
import { useSearchParams } from "next/navigation"
import { ModificationsEditor } from "@/components/modifications/modifications-editor"
import { ScenarioEntitiesEditor } from "@/components/modifications/scenario-entities-editor"

function Editor() {
  const { t: translateText } = useI18n()

  const ref = useSearchParams().get("ref") ?? undefined
  const [mode, setMode] = useState("entities")
  return <>
    <nav className="flex gap-2 border-b pb-2" aria-label={translateText("Modo de edição")}>
      {[["entities", "Entidades e mapa"], ["operations", "Operações what-if"]].map(([id, label]) => <button type="button" key={id} aria-pressed={mode === id}
        className={`rounded-sm border px-3 py-2 text-xs ${mode === id ? "border-primary bg-primary/10" : "border-border"}`} onClick={() => setMode(id!)}>{translateText(label)}</button>)}
    </nav>
    <div hidden={mode !== "entities"}><ScenarioEntitiesEditor initialRef={ref} active={mode === "entities"} /></div>
    <div hidden={mode !== "operations"}><ModificationsEditor initialRef={ref} /></div>
  </>
}

export default function ModificationsPage() {
  const { t: translateText } = useI18n()

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <div>
        <h1 className="font-serif text-xl">{translateText("Modificações do cenário")}</h1>
        <p className="text-xs text-muted-foreground">{translateText("Edite rede, transporte e demanda em rascunhos e publique novas revisões. O cenário base é preservado. As operações what-if continuam disponíveis na outra aba.")}</p>
      </div>
      <Suspense fallback={null}>
        <Editor />
      </Suspense>
    </div>
  )
}
