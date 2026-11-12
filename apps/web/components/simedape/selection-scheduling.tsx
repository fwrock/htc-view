"use client"

import { useEffect, useState } from "react"
import { useI18n } from "@/components/i18n-provider"
import { getSelectionScheduling, setSelectionScheduling, type SelectionScheduling } from "@/lib/simedape-api"

export function SelectionSchedulingControl({ onChange }: { onChange: (value: SelectionScheduling | null) => void }) {
  const { t } = useI18n()
  const [settings, setSettings] = useState<SelectionScheduling | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    getSelectionScheduling().then(value => {
      if (!cancelled) { setSettings(value); onChange(value) }
    }).catch(() => { if (!cancelled) onChange(null) })
    return () => { cancelled = true }
  }, [onChange])
  if (!settings) return null
  return <div className="flex flex-col gap-1 rounded-sm border border-border p-3 text-xs">
    <label className="flex items-center gap-3">
      <span>{t("Parallel selection jobs")}</span>
      <select aria-label={t("Parallel selection jobs")} className="rounded-sm border border-border bg-background p-1" disabled={busy} value={settings.selection_parallelism} onChange={async event => {
        const count = Number(event.target.value)
        setBusy(true); setError(null)
        try { const value = await setSelectionScheduling(count); setSettings(value); onChange(value) }
        catch (e) { setError((e as Error).message) }
        finally { setBusy(false) }
      }}>
        {Array.from({ length: settings.selection_max_parallelism }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
      </select>
    </label>
    <p className="text-muted-foreground">{t("Saved-model selections can run together. Training and other jobs wait separately. More parallel selections use more JVM heap; 1 runs them sequentially.")}</p>
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </div>
}
