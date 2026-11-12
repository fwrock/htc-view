"use client"

import { useContext, useState } from "react"
import { useI18n } from "@/components/i18n-provider"
import { collectReportPanels, exportVectorReport } from "@/lib/metrics-export"
import { ExportContext } from "./charts"

/** Export every mounted panel in a report, with its complete supplied data. */
export function ReportDownloads() {
  const { t } = useI18n()
  const meta = useContext(ExportContext)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return <span className="inline-flex flex-col gap-1">
    <button type="button" disabled={busy} className="rounded-sm border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50" onClick={async (event) => {
      const root = event.currentTarget.closest<HTMLElement>("[data-report-root]")
      if (!root) return
      setBusy(true)
      setError(null)
      try { await exportVectorReport(collectReportPanels(root), { ...meta, generatedAt: Date.now() }, "zip") }
      catch (e) { setError((e as Error).message) }
      finally { setBusy(false) }
    }}>{busy ? t("…") : t("Report files (ZIP)")}</button>
    {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
  </span>
}
