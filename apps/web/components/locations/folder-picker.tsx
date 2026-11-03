"use client"

import { useI18n } from "@/components/i18n-provider"

import { useCallback, useEffect, useState } from "react"
import { Folder, FolderOpen } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { browseFolders, type BrowseResult } from "@/lib/simedape-api"

/** Browses folders on the machine where the HTC View API runs (where local/docker paths are read). */
export function FolderPicker({
  start,
  onPick,
  onClose,
}: {
  start?: string
  onPick: (path: string) => void
  onClose: () => void
}) {
  const { t: translateText } = useI18n()

  const [data, setData] = useState<BrowseResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const open = useCallback(async (path?: string) => {
    try {
      setData(await browseFolders(path))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => {
    // Falls back to the browsable root when the typed path does not exist.
    browseFolders(start || undefined)
      .then(setData)
      .catch(() => browseFolders().then(setData).catch((e) => setError(e.message)))
  }, [start])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-label={translateText("Escolher pasta")}>
      <div className="flex max-h-[80vh] w-full max-w-xl flex-col gap-3 rounded-sm border border-border bg-card p-4 shadow-lg">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{translateText("Escolher pasta")}</h2>
          <Button size="sm" variant="ghost" onClick={onClose}>{translateText("Fechar")}</Button>
        </div>
        {error && <p className="text-xs text-destructive" role="alert">{translateText(error)}</p>}
        {data && (
          <>
            <p className="break-all font-mono text-[11px] text-muted-foreground">{translateText(data.path)}</p>
            <ul className="min-h-40 flex-1 overflow-y-auto rounded-sm border border-border text-xs">
              {data.parent && (
                <li>
                  <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/50" onClick={() => open(data.parent!)}>
                    <FolderOpen className="size-3.5" />{translateText(" .. (acima)")}</button>
                </li>
              )}
              {data.entries.length === 0 && <li className="px-3 py-2 text-muted-foreground">{translateText("Sem subpastas.")}</li>}
              {data.entries.map((e) => (
                <li key={e.path}>
                  <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/50" onClick={() => open(e.path)}>
                    <Folder className="size-3.5" />
                    <span className="flex-1 truncate">{translateText(e.name)}</span>
                    {e.scenarios > 0 && <span className="text-[10px] text-green-600 dark:text-green-400">{translateText(e.scenarios)}{translateText(" cenário(s)")}</span>}
                    {e.is_scenario && <span className="text-[10px] text-amber-600 dark:text-amber-400">{translateText("é um cenário")}</span>}
                  </button>
                </li>
              ))}
            </ul>
            {data.is_scenario && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">{translateText("Esta pasta é um cenário. Escolha a pasta que contém os cenários (a pasta acima).")}</p>
            )}
            {data.truncated && <p className="text-[11px] text-muted-foreground">{translateText("Lista truncada em 500 pastas.")}</p>}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">
                {data.scenarios > 0 ? translateText("{0} cenário(s) nesta pasta", { 0: data.scenarios }) : translateText("Nenhum cenário direto nesta pasta")}
              </span>
              <Button size="sm" onClick={() => onPick(data.path)}>{translateText("Usar esta pasta")}</Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
