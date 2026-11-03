import { LocalizedText } from "@/components/i18n-provider"
import Link from "next/link"
import {
  ScenarioInputGuide,
  type ScenarioInputFlow,
} from "@/components/htc-runs/scenario-input-guide"
import { OsmScenarioCreator } from "@/components/htc-runs/osm-scenario-creator"

export default async function ScenarioInputPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = await searchParams
  const job = typeof query.job === "string" ? query.job : null
  const flow: ScenarioInputFlow =
    job || query.flow === "osm"
      ? "osm"
      : query.flow === "existing"
        ? "existing"
        : query.flow === "combine"
          ? "combine"
          : query.flow === "population"
            ? "population"
            : "choose"
  if (flow === "osm")
    return <OsmScenarioCreator key={job ?? "new"} initialJobId={job} />
  const titles = {
    choose: "Como você quer preparar seu cenário?",
    existing: "Usar um cenário HTC existente",
    combine: "Mapa JSON HTC e associação com OSM",
    population: "População sintética EQASim / MATSim no HTC",
  }
  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-lg font-semibold"><LocalizedText>{titles[flow]}</LocalizedText></h1>
        <p className="text-sm text-muted-foreground"><LocalizedText>Escolha o caminho de acordo com os arquivos que você já tem. Um cenário é a entrada do HTC; resultados e replay são gerados depois da execução.</LocalizedText></p>
        <div className="flex flex-wrap gap-4 text-xs text-primary">
          {flow !== "choose" && (
            <Link href="/simulator/import" className="underline"><LocalizedText>← Escolher outro tipo de entrada</LocalizedText></Link>
          )}
          <Link href="/simulator/runs" className="underline"><LocalizedText>Execuções HTC</LocalizedText></Link>
        </div>
      </header>
      <ScenarioInputGuide flow={flow} />
    </div>
  )
}
