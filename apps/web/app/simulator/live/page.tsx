import { LocalizedText } from "@/components/i18n-provider"
import { LiveEntry } from "@/components/live/live-entry"

export default async function SimulatorLivePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = await searchParams
  const runId = typeof query.run === "string" ? query.run : null
  if (runId && !/^[a-f0-9]{32}$/.test(runId))
    return (
      <p role="alert" className="p-6 text-sm"><LocalizedText>Identificador de execução inválido.</LocalizedText></p>
    )
  return (
    <div className="relative h-full w-full overflow-hidden">
      <LiveEntry key={runId ?? "general"} runId={runId} />
    </div>
  )
}
