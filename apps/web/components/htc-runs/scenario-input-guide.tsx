"use client"

import { useI18n } from "@/components/i18n-provider"
import Link from "next/link"
import { ArrowRight, FileJson, GitMerge, Map } from "lucide-react"

export type ScenarioInputFlow =
  | "choose"
  | "existing"
  | "osm"
  | "combine"
  | "population"

const link =
  "inline-flex items-center gap-2 rounded-sm bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
const secondary =
  "inline-flex items-center gap-2 rounded-sm border border-border px-3 py-2 text-sm hover:bg-muted"

export function ScenarioInputGuide({ flow }: { flow: ScenarioInputFlow }) {
  const { t: translateText } = useI18n()

  if (flow === "choose")
    return (
      <section
        className="grid gap-4 lg:grid-cols-2"
        aria-label={translateText("Escolha o tipo de entrada")}
      >
        <article className="flex flex-col items-start gap-3 rounded-sm border border-border bg-card p-5">
          <FileJson className="size-6 text-primary" aria-hidden="true" />
          <h2 className="text-base font-semibold">{translateText("Já tenho um cenário HTC")}</h2>
          <p className="flex-1 text-sm text-muted-foreground">{translateText("Uma pasta com ")}<code>simulation.json</code>{translateText(", mapa e arquivos dos atores. Cadastre a pasta e use o cenário diretamente.")}</p>
          <p className="text-xs text-muted-foreground">{translateText("Entrada: cenário HTC existente → execução no HTC.")}</p>
          <Link href="/simulator/import?flow=existing" className={link}>{translateText("Usar meus arquivos HTC ")}<ArrowRight className="size-4" />
          </Link>
        </article>
        <article className="flex flex-col items-start gap-3 rounded-sm border border-primary/40 bg-card p-5">
          <Map className="size-6 text-primary" aria-hidden="true" />
          <h2 className="text-base font-semibold">{translateText("Quero criar um cenário a partir de OSM")}</h2>
          <p className="flex-1 text-sm text-muted-foreground">{translateText("Escolha um arquivo OpenStreetMap e uma área. A ferramenta cria uma nova pasta de entrada HTC com ruas e carros de teste.")}</p>
          <p className="text-xs text-muted-foreground">{translateText("Entrada: .osm / XML / gzip → saída: cenário HTC em JSON.")}</p>
          <Link href="/simulator/import?flow=osm" className={link}>{translateText("Converter OSM para HTC ")}<ArrowRight className="size-4" />
          </Link>
        </article>
        <article className="flex flex-col items-start gap-3 rounded-sm border border-border bg-card p-5">
          <FileJson className="size-6 text-primary" aria-hidden="true" />
          <h2 className="text-base font-semibold">{translateText("Tenho população EQASim / MATSim")}</h2>
          <p className="flex-1 text-sm text-muted-foreground">{translateText("Combine a população sintética e suas atividades com uma rede compatível, gere os atores HTC e execute o cenário no motor.")}</p>
          <p className="text-xs text-muted-foreground">{translateText("Conversores por CLI disponíveis; assistente de população na tela ainda pendente.")}</p>
          <Link href="/simulator/import?flow=population" className={secondary}>{translateText("Ver o caminho da população ")}<ArrowRight className="size-4" />
          </Link>
        </article>
        <article className="flex flex-col items-start gap-3 rounded-sm border border-border bg-card p-5">
          <GitMerge
            className="size-6 text-muted-foreground"
            aria-hidden="true"
          />
          <h2 className="text-base font-semibold">{translateText("Tenho só um mapa JSON ou quero combinar com OSM")}</h2>
          <p className="flex-1 text-sm text-muted-foreground">{translateText("Veja o que falta para executar um mapa avulso e o que é necessário para associar uma rede HTC às ruas OSM.")}</p>
          <p className="text-xs text-muted-foreground">{translateText("Combinação automática de redes: ainda indisponível.")}</p>
          <Link href="/simulator/import?flow=combine" className={secondary}>{translateText("Entender esta opção ")}<ArrowRight className="size-4" />
          </Link>
        </article>
      </section>
    )

  if (flow === "existing")
    return (
      <section
        className="grid gap-5 lg:grid-cols-2"
        aria-label={translateText("Usar cenário HTC existente")}
      >
        <div className="flex flex-col gap-4 rounded-sm border border-border bg-card p-5">
          <h2 className="text-base font-semibold">{translateText("Use a pasta do cenário, com os arquivos referenciados")}</h2>
          <p className="text-sm text-muted-foreground">{translateText("O ")}<code>simulation.json</code>{translateText(" indica os atores, o mapa e a configuração que o HTC deve ler. Os nomes dos arquivos podem variar; mantenha as referências válidas.")}</p>
          <ol className="list-decimal space-y-3 pl-5 text-sm">
            <li>{translateText("Em ")}<strong>{translateText("Locais")}</strong>{translateText(", cadastre como entrada a pasta que contém os seus cenários.")}</li>
            <li>{translateText("Abra ")}<strong>{translateText("Execuções HTC")}</strong>{translateText(" e selecione o cenário pelo nome.")}</li>
            <li>{translateText("Execute e abra o replay dos resultados. O seletor explica quando um cenário está fora do perfil suportado.")}</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <Link href="/locations" className={secondary}>{translateText("Cadastrar pasta de cenários")}</Link>
            <Link href="/simulator/runs" className={link}>{translateText("Ver cenários e executar ")}<ArrowRight className="size-4" />
            </Link>
          </div>
          <p className="text-xs text-muted-foreground">{translateText("Para usar um engine já em serviço e suas configurações, abra o")}{" "}
            <Link href="/simulator" className="text-primary underline">{translateText("Simulador")}</Link>
            .
          </p>
          <p className="text-sm text-muted-foreground">{translateText("Cenários com pessoas, veículos próprios ou transporte público usam o engine pelo Simulador. O formulário de Execuções HTC atual atende ao perfil menor de carros independentes em links MICRO, MESO ou mistos.")}</p>
        </div>
        <div className="flex flex-col gap-3 rounded-sm border border-border p-5">
          <h2 className="text-sm font-semibold">{translateText("Exemplo de organização")}</h2>
          <pre className="overflow-x-auto rounded-sm bg-muted p-4 text-xs leading-6">{`meus-cenarios/          ← cadastre esta pasta em Locais
└── bairro-centro/
    ├── simulation.json
    └── data/
        ├── city_map.json
        ├── nodes_0.json
        ├── links_0.json
        └── cars_0.json`}</pre>
          <p className="text-sm text-muted-foreground">{translateText("Um cenário HTC pode usar um mapa independente ou já conter a correspondência OSM. A opção de conversão é para criar um cenário novo a partir de uma fonte OSM.")}</p>
          <Link
            href="/simulator/import?flow=combine"
            className="text-sm text-primary underline"
          >{translateText("Tenho apenas city_map.json. O que falta?")}</Link>
        </div>
      </section>
    )

  if (flow === "population")
    return (
      <section
        className="flex flex-col gap-4 rounded-sm border border-border bg-card p-5"
        aria-label={translateText("População EQASim e MATSim")}
      >
        <h2 className="text-base font-semibold">{translateText("Rede real e população sintética podem formar o mesmo cenário")}</h2>
        <p className="text-sm text-muted-foreground">{translateText("O mapa define onde as pessoas viajam. A população define atividades, horários e modos. Uma população EQASim/MATSim é sintética mesmo quando foi construída para representar uma cidade real.")}</p>
        <ol className="list-decimal space-y-3 pl-5 text-sm">
          <li>
            <strong>{translateText("Prepare fontes compatíveis:")}</strong>{translateText(" população, rede, sistema de coordenadas e, quando necessário, serviços de transporte público.")}</li>
          <li>
            <strong>{translateText("Converta para HTC:")}</strong>{translateText(" os conversores de São Paulo e Toulouse geram simulation.json, mapa e atores. O HTC recebe esses arquivos nativos, não o XML MATSim diretamente.")}</li>
          <li>
            <strong>{translateText("Execute pelo engine:")}</strong>{translateText(" cadastre a pasta gerada em Locais e selecione o cenário no Simulador. O formulário menor de Execuções HTC ainda não executa pessoas e transporte público.")}</li>
          <li>
            <strong>{translateText("Valide a visualização:")}</strong>{translateText(" conferir coordenadas e entrega de eventos/geometria ao HTC View faz parte da integração deste cenário. O sucesso do pequeno teste OSM não valida automaticamente uma população completa.")}</li>
        </ol>
        <div className="rounded-sm bg-muted p-4 text-sm">
          <p className="font-semibold">{translateText("Disponível hoje")}</p>
          <p className="mt-1 text-muted-foreground">{translateText("Conversores offline e suporte do motor a pessoas/veículos. Há validação registrada em um pequeno cenário híbrido. A execução completa da população da cidade, o assistente web de conversão e sua aceitação visual continuam pendentes.")}</p>
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer">{translateText("Arquivos esperados pelos conversores")}</summary>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-muted-foreground">
            <li>{translateText("São Paulo / EQASim: persons.csv, trips.csv, activities.gpkg e rede OSM; GTFS opcional.")}</li>
            <li>{translateText("São Paulo / MATSim: plans XML ou XML.gz, CRS explícito e rede OSM.")}</li>
            <li>{translateText("Toulouse: população e rede MATSim; tabela de transporte público quando habilitada. A origem de coordenadas precisa ser verificada antes de usar fundo OSM.")}</li>
          </ul>
        </details>
        <div className="flex flex-wrap gap-2">
          <Link href="/locations" className={secondary}>{translateText("Cadastrar cenário já convertido")}</Link>
          <Link href="/simulator" className={link}>{translateText("Abrir Simulador ")}<ArrowRight className="size-4" />
          </Link>
        </div>
      </section>
    )

  if (flow === "combine")
    return (
      <section
        className="flex flex-col gap-5 rounded-sm border border-border bg-card p-5"
        aria-label={translateText("Mapa avulso e associação OSM")}
      >
        <div>
          <h2 className="text-base font-semibold">{translateText("Um mapa JSON é uma parte do cenário")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{translateText("Para executar, o HTC também precisa dos atores da rede, da demanda de veículos e do ")}<code>simulation.json</code>{translateText(" que referencia esses arquivos. Esta tela não transforma um ")}<code>city_map.json</code>{" "}{translateText("avulso em um cenário completo.")}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border">
              <tr>
                <th className="p-2">{translateText("O que você tem")}</th>
                <th className="p-2">{translateText("Como seguir")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr>
                <td className="p-2">{translateText("Cenário HTC completo")}</td>
                <td className="p-2">{translateText("Cadastre a pasta em Locais e selecione o cenário para executar.")}</td>
              </tr>
              <tr>
                <td className="p-2">{translateText("Somente city_map.json")}</td>
                <td className="p-2">{translateText("Reúna a configuração, os atores e a demanda que pertencem a essa rede.")}</td>
              </tr>
              <tr>
                <td className="p-2">{translateText("Arquivo OSM")}</td>
                <td className="p-2">{translateText("A conversão disponível cria uma rede HTC nova e carros sintéticos para testar.")}</td>
              </tr>
              <tr>
                <td className="p-2">{translateText("Rede HTC existente + ruas OSM")}</td>
                <td className="p-2">{translateText("A associação automática ainda precisa ser implementada e validada.")}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="rounded-sm border border-border bg-muted/40 p-4">
          <h3 className="text-sm font-semibold">{translateText("Combinar HTC e OSM exige uma correspondência da rede")}</h3>
          <p className="mt-2 text-sm text-muted-foreground">{translateText("É preciso conferir coordenadas, nós, sentidos e quais links HTC pertencem a cada via OSM. Colocar um fundo OSM atrás da rede não estabelece essa correspondência. A conversão disponível preserva a origem OSM ao criar uma rede nova; ela não mescla seus arquivos HTC existentes.")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/simulator/import?flow=existing" className={secondary}>{translateText("Usar cenário HTC completo")}</Link>
          <Link href="/simulator/import?flow=osm" className={link}>{translateText("Criar um cenário novo de OSM ")}<ArrowRight className="size-4" />
          </Link>
        </div>
      </section>
    )

  return (
    <section
      className="grid gap-3 rounded-sm border border-primary/30 bg-primary/5 p-4 md:grid-cols-3"
      aria-label={translateText("Entrada e saída da conversão")}
    >
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase">{translateText("Você fornece")}</p>
        <p className="mt-1 text-sm">{translateText("Um arquivo OSM/XML/gzip com as ruas. O mapa JSON HTC será gerado.")}</p>
      </div>
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase">{translateText("A ferramenta cria")}</p>
        <p className="mt-1 text-sm">{translateText("Uma pasta nova com ")}<code>simulation.json</code>,{" "}
          <code>city_map.json</code>{translateText(", nós, links e carros de teste em JSON.")}</p>
      </div>
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase">{translateText("Você faz depois")}</p>
        <p className="mt-1 text-sm">{translateText("Executa esse cenário no HTC e abre o replay. Os arquivos são salvos na pasta escolhida da máquina da API.")}</p>
      </div>
    </section>
  )
}
