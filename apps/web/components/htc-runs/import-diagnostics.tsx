"use client"

import { useI18n } from "@/components/i18n-provider"
import type { ImportReport } from "@/lib/osm-import-api"

const explanations: Record<string, { title: string; action: string }> = {
  DEFAULT_SPEED: {
    title: "Velocidade ausente na fonte",
    action: "O teste usará 30 km/h nessas vias.",
  },
  LANE_PROFILE: {
    title: "Modelo de uma faixa",
    action:
      "O cenário de teste usa uma faixa; as tags originais ficam preservadas.",
  },
  TURN_RESTRICTION_UNSUPPORTED: {
    title: "Restrição de conversão ainda não suportada",
    action:
      "Escolha outra área ou use um cenário HTC que já modele essa restrição.",
  },
  CONDITIONAL_RULE_UNSUPPORTED: {
    title: "Regra condicional ainda não suportada",
    action: "Esta regra exige conversão específica antes de executar a via.",
  },
  ACCESS_RULE_UNSUPPORTED: {
    title: "Permissão de acesso exige tratamento",
    action:
      "A conversão não consegue decidir o acesso dos carros sintéticos a essa via.",
  },
  DISCONNECTED_NETWORK: {
    title: "A seleção tem partes desconectadas",
    action:
      "Ajuste a área. Se isso for intencional, permita partes desconectadas nas opções avançadas.",
  },
  SELECTION_TOO_LARGE: {
    title: "Há vias demais nessa área",
    action:
      "Aproxime o mapa e selecione uma área menor. Este perfil aceita até 100 vias.",
  },
  PREVIEW_CHANGED: {
    title: "A fonte mudou depois da prévia",
    action: "Gere uma nova prévia e revise o resultado antes de salvar.",
  },
  INCOMPLETE_WAY: {
    title: "Faltam coordenadas de uma via",
    action: "Use um extrato OSM completo para a área escolhida.",
  },
  EMPTY_SELECTION: {
    title: "Nenhuma rua elegível na área escolhida",
    action:
      "Confira se a área está dentro do arquivo OSM e tente uma área diferente. Este perfil usa vias urbanas para carros.",
  },
  DIRECTIONAL_RULE_UNSUPPORTED: {
    title: "Regras por sentido exigem conversão específica",
    action:
      "Esta via possui regras que o perfil de teste ainda não consegue representar.",
  },
  SHORT_OR_LOOP_LINK: {
    title: "A rede contém um trecho curto ou fechado",
    action:
      "O perfil atual exige trechos abertos de pelo menos 10 metros. Escolha outra área ou use um cenário já preparado para essa geometria.",
  },
  ACCESS_EXCLUDED: {
    title: "Vias sem acesso foram excluídas",
    action:
      "A rede de carros não inclui vias marcadas como privadas ou sem acesso.",
  },
}

export function ImportDiagnostics({ report }: { report: ImportReport }) {
  const { t: translateText } = useI18n()

  const groups = new Map<
    string,
    { level: string; code: string; count: number; message: string }
  >()
  for (const item of report.diagnostics) {
    const key = `${item.level}:${item.code}`
    const group = groups.get(key)
    if (group) group.count++
    else groups.set(key, { ...item, count: 1 })
  }
  if (!groups.size)
    return (
      <p className="text-sm text-muted-foreground">{translateText("Nenhum problema encontrado para este perfil de teste.")}</p>
    )
  return (
    <div className="flex flex-col gap-3" aria-label={translateText("Diagnósticos da prévia")}>
      <ul className="space-y-2 text-sm">
        {[...groups.values()].map((group) => {
          const explanation = explanations[group.code]
          return (
            <li
              key={`${group.level}:${group.code}`}
              className={`rounded-sm border p-3 ${group.level === "error" ? "border-destructive/40" : "border-border"}`}
            >
              <p className="font-medium">
                {group.level === "error" ? translateText("Precisa resolver") : translateText("Atenção")}:{" "}
                {translateText(explanation?.title ?? group.code)}
                {group.count > 1 ? translateText(" · {0} ocorrências", { 0: group.count }) : translateText("")}
              </p>
              <p className="mt-1 text-muted-foreground">
                {translateText(explanation?.action ?? group.message)}
              </p>
            </li>
          )
        })}
      </ul>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">{translateText("Ver mensagens técnicas e vias afetadas (")}{report.diagnostics.length})
        </summary>
        <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
          {report.diagnostics.map((item, index) => (
            <li key={index}>
              <strong>{translateText(item.code)}</strong> · {translateText(item.entity)}: {translateText(item.message)}
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
