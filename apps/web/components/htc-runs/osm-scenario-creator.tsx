"use client"

import { useI18n } from "@/components/i18n-provider"

import dynamic from "next/dynamic"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { Button } from "@workspace/ui/components/button"
import {
  addLocation,
  listLocations,
  type SimLocation,
} from "@/lib/simedape-api"
import { FolderPicker } from "@/components/locations/folder-picker"
import { ScenarioInputGuide } from "./scenario-input-guide"
import { ImportDiagnostics } from "./import-diagnostics"
import {
  browseOsmSources,
  getOsmJob,
  previewOsm,
  publishOsm,
  OsmImportApiError,
  type ImportJob,
  type ImportOptions,
  type ImportReport,
  type SourceListing,
} from "@/lib/osm-import-api"

const PreviewMap = dynamic(
  () => import("@/components/htc-runs/osm-import-map"),
  {
    ssr: false,
    loading: function LoadingMap() {
  const { t: translateText } = useI18n()
 return (
      <div
        className="h-[420px] animate-pulse rounded-sm bg-muted"
        aria-label={translateText("Carregando mapa")}
      />
    ) },
  }
)
const input = "h-9 rounded-sm border border-input bg-background px-2 text-sm"
const defaultOptions: ImportOptions = {
  bbox: null,
  max_ways: 100,
  cars: 16,
  duration: 900,
  allow_disconnected: false,
}

function suggestedName(source: string) {
  const stem = (source.split("/").pop() ?? "cenario-osm")
    .replace(/\.(?:gz|osm|xml)$/gi, "")
    .replace(/\.(?:osm|xml)$/i, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 65)
  return `${stem || "cenario-osm"}-v1`
}

export function OsmScenarioCreator({
  initialJobId,
}: {
  initialJobId: string | null
}) {
  const { t: translateText } = useI18n()

  const router = useRouter()
  const [locations, setLocations] = useState<SimLocation[]>([])
  const [sourceLocation, setSourceLocation] = useState("")
  const [targetLocation, setTargetLocation] = useState("")
  const [directory, setDirectory] = useState("")
  const [listing, setListing] = useState<SourceListing | null>(null)
  const [source, setSource] = useState("")
  const [options, setOptions] = useState(defaultOptions)
  const [coordinates, setCoordinates] = useState(["", "", "", ""])
  const [revision, setRevision] = useState("")
  const [areaMode, setAreaMode] = useState<"whole" | "bbox">("whole")
  const [loadingLocations, setLoadingLocations] = useState(true)
  const [picker, setPicker] = useState<"source" | "target" | null>(null)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(initialJobId)
  const [job, setJob] = useState<ImportJob | null>(null)
  const [starting, setStarting] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [browseError, setBrowseError] = useState<string | null>(null)
  const jobBusy =
    !!jobId && (!job || job.status === "queued" || job.status === "running")
  const busy = starting || registering || jobBusy
  const candidate = coordinates.map(Number)
  const box =
    areaMode === "bbox" &&
    coordinates.every(
      (value) => value.trim() !== "" && Number.isFinite(Number(value))
    ) &&
    candidate[0]! >= -180 &&
    candidate[2]! <= 180 &&
    candidate[0]! < candidate[2]! &&
    candidate[1]! >= -85.05112878 &&
    candidate[3]! <= 85.05112878 &&
    candidate[1]! < candidate[3]!
      ? (coordinates.map(Number) as NonNullable<ImportOptions["bbox"]>)
      : null

  useEffect(() => {
    let active = true
    listLocations("input")
      .then((data) => {
        if (!active) return
        const local = data.locations.filter(
          (location) => location.kind === "local" || location.kind === "docker"
        )
        setLocations(local)
      })
      .catch((e: Error) => active && setError(e.message))
      .finally(() => active && setLoadingLocations(false))
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!sourceLocation) return
    let active = true
    browseOsmSources(sourceLocation, directory)
      .then((data) => {
        if (active) {
          setListing(data)
          setBrowseError(null)
        }
      })
      .catch((e: Error) => active && setBrowseError(e.message))
    return () => {
      active = false
    }
  }, [sourceLocation, directory])

  useEffect(() => {
    if (!jobId) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const data = await getOsmJob(jobId)
        if (!active) return
        if (
          !["htc_osm_preview", "htc_osm_publish"].includes(
            data.meta.workflow ?? ""
          )
        ) {
          setError("Este job não é uma importação OSM.")
          setJobId(null)
          return
        }
        setJob(data)
        setError(null)
        if (data.status === "completed") {
          const result = data.result?.osm_import
          if (!result) {
            setError("O job terminou sem relatório de importação.")
            return
          }
          setReport(result)
          if (
            data.meta.source_location &&
            data.meta.source &&
            data.meta.options
          ) {
            setSourceLocation(data.meta.source_location)
            setSource(data.meta.source)
            setDirectory(data.meta.source.split("/").slice(0, -1).join("/"))
            setOptions(data.meta.options)
            setCoordinates(
              data.meta.options.bbox?.map(String) ?? ["", "", "", ""]
            )
            setAreaMode(data.meta.options.bbox ? "bbox" : "whole")
            setRevision(data.meta.revision ?? suggestedName(data.meta.source))
            if (data.meta.target_location)
              setTargetLocation(data.meta.target_location)
          }
          if (data.meta.workflow === "htc_osm_preview")
            setPreviewId(result.status === "ready" ? jobId : null)
          if (data.meta.workflow === "htc_osm_publish") setPreviewId(null)
          return
        }
        if (data.status === "failed" || data.status === "cancelled") {
          setError(data.error ?? "Operação cancelada.")
          return
        }
      } catch (e) {
        if (!active) return
        if (e instanceof OsmImportApiError && e.status === 404) {
          setError(
            "Job de importação não encontrado nesta API. Prepare uma nova prévia."
          )
          setJobId(null)
          return
        }
        setError(
          `Falha ao consultar o job; tentando novamente. ${(e as Error).message}`
        )
      }
      if (active) timer = setTimeout(() => void poll(), 1000)
    }
    void poll()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [jobId])

  function invalidate() {
    setPreviewId(null)
    setReport(null)
    setError(null)
  }
  function openDirectory(path: string) {
    setListing(null)
    setBrowseError(null)
    setDirectory(path)
  }
  function chooseArea(area: NonNullable<ImportOptions["bbox"]>) {
    setAreaMode("bbox")
    setCoordinates(area.map((value) => value.toFixed(7)))
    invalidate()
  }
  async function startPreview() {
    if (areaMode === "bbox" && !box) {
      setError(
        "Selecione uma área visível no mapa ou preencha coordenadas válidas: oeste < leste e sul < norte."
      )
      return
    }
    setStarting(true)
    invalidate()
    try {
      const result = await previewOsm(sourceLocation, source, {
        ...options,
        bbox: box,
      })
      setJob(null)
      setJobId(result.run_id)
      router.replace(
        `/simulator/import?job=${encodeURIComponent(result.run_id)}`,
        { scroll: false }
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setStarting(false)
    }
  }
  async function publish() {
    if (!previewId) return
    setStarting(true)
    setError(null)
    try {
      const result = await publishOsm(previewId, targetLocation, revision)
      setJob(null)
      setJobId(result.run_id)
      router.replace(
        `/simulator/import?job=${encodeURIComponent(result.run_id)}`,
        { scroll: false }
      )
    } catch (e) {
      setError(
        e instanceof OsmImportApiError && e.status === 409
          ? "Já existe um cenário com esse nome nessa pasta. Escolha outro nome para salvar uma nova versão."
          : (e as Error).message
      )
    } finally {
      setStarting(false)
    }
  }

  async function pickFolder(path: string) {
    const purpose = picker
    setPicker(null)
    if (!purpose) return
    setRegistering(true)
    setError(null)
    try {
      let location = locations.find(
        (item) => item.path.replace(/\/+$/, "") === path.replace(/\/+$/, "")
      )
      if (!location) {
        const created = await addLocation({
          id: `osm-${purpose}-${Date.now().toString(36)}`,
          kind: "local",
          path,
          role: "input",
          label: `${purpose === "source" ? "Fonte OSM" : "Cenários HTC"} · ${path.split("/").filter(Boolean).pop() ?? path}`,
        })
        location = created
        setLocations((current) => [...current, created])
      }
      if (purpose === "source") {
        setSourceLocation(location.id)
        openDirectory("")
        setSource("")
        invalidate()
      } else setTargetLocation(location.id)
    } catch (e) {
      setError(`Não foi possível usar essa pasta: ${(e as Error).message}`)
    } finally {
      setRegistering(false)
    }
  }

  const sourceFolder = locations.find((item) => item.id === sourceLocation)
  const targetFolder = locations.find((item) => item.id === targetLocation)
  const outputPath = targetFolder
    ? `${targetFolder.path.replace(/\/+$/, "")}/${revision || "nome-do-cenario"}/`
    : null
  const currentStep =
    report?.status === "published"
      ? 4
      : report?.status === "ready"
        ? 3
        : source
          ? 2
          : 1

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
      <header>
        <h1 className="font-heading text-lg font-semibold">{translateText("Criar cenário HTC a partir de OSM")}</h1>
        <p className="text-sm text-muted-foreground">{translateText("Converta ruas OpenStreetMap em uma nova entrada do simulador HTC.")}</p>
        <div className="mt-2 flex gap-4 text-xs text-primary">
          <Link href="/simulator/runs" className="underline">{translateText("Execuções HTC")}</Link>
          <Link href="/simulator/import" className="underline">{translateText("← Escolher outro tipo de entrada")}</Link>
        </div>
      </header>
      <ScenarioInputGuide flow="osm" />
      {registering && (
        <p role="status" className="text-sm text-muted-foreground">{translateText("Preparando acesso à pasta escolhida…")}</p>
      )}
      <ol
        className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4"
        aria-label={translateText("Etapas da criação do cenário")}
      >
        {[
          "Escolher arquivo OSM",
          "Analisar ruas e teste",
          "Revisar e salvar HTC",
          "Executar e ver replay",
        ].map((label, index) => (
          <li
            key={label}
            aria-current={currentStep === index + 1 ? "step" : undefined}
            className={`rounded-sm border p-3 ${currentStep === index + 1 ? "border-primary bg-primary/5 font-semibold" : "border-border text-muted-foreground"}`}
          >
            {translateText(index + 1)}. {translateText(label)}
          </li>
        ))}
      </ol>
      {error && (
        <p
          role="alert"
          className="rounded-sm border border-destructive/40 p-3 text-sm text-destructive"
        >
          {translateText(error)}
        </p>
      )}
      {!loadingLocations && locations.length === 0 && (
        <p className="text-sm text-muted-foreground">{translateText("Comece escolhendo a pasta onde está o arquivo OSM. Ela ficará cadastrada em Locais para os próximos usos.")}</p>
      )}

      <fieldset
        disabled={busy || loadingLocations}
        className="grid gap-5 disabled:opacity-70 lg:grid-cols-[minmax(280px,1fr)_minmax(400px,2fr)]"
      >
        <section
          className="flex min-w-0 flex-col gap-3 rounded-sm border border-border bg-card p-4"
          aria-label={translateText("Fonte e perfil")}
        >
          <h2 className="text-base font-semibold">{translateText("1. Onde está seu arquivo OSM?")}</h2>
          <label className="flex flex-col gap-1 text-xs">{translateText("Pasta de origem cadastrada")}<select
              className={input}
              value={sourceLocation}
              onChange={(e) => {
                setSourceLocation(e.target.value)
                openDirectory("")
                setSource("")
                invalidate()
              }}
            >
              <option value="">{translateText("Escolha a pasta que contém o OSM")}</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {translateText(location.label || location.id)}
                </option>
              ))}
            </select>
          </label>
          {sourceFolder && (
            <p className="text-xs break-all text-muted-foreground">
              {translateText(sourceFolder.path)}
            </p>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPicker("source")}
          >{translateText("Escolher outra pasta no servidor")}</Button>
          <p className="text-xs text-muted-foreground">{translateText("A seleção acessa os arquivos da máquina onde a API roda. A pasta escolhida fica cadastrada em Locais.")}</p>
          {sourceLocation && (
            <div className="rounded-sm border border-border p-2">
              <p className="text-xs break-all text-muted-foreground">{translateText("Pasta: ")}{translateText(directory || "/")}
              </p>
              {browseError && (
                <p role="alert" className="mt-2 text-xs text-destructive">
                  {translateText(browseError)}
                </p>
              )}
              {listing?.parent !== null && listing?.parent !== undefined && (
                <button
                  type="button"
                  className="my-1 text-xs text-primary underline"
                  onClick={() => openDirectory(listing.parent ?? "")}
                >{translateText("↑ Pasta anterior")}</button>
              )}
              <ul
                className="max-h-48 overflow-y-auto"
                aria-label={translateText("Arquivos OSM")}
              >
                {listing?.entries.map((entry) => (
                  <li key={entry.path}>
                    <button
                      type="button"
                      aria-pressed={!entry.directory && source === entry.path}
                      className={`w-full rounded-sm px-2 py-1 text-left text-xs break-all hover:bg-muted ${source === entry.path ? "bg-muted font-semibold" : ""}`}
                      onClick={() => {
                        if (entry.directory) openDirectory(entry.path)
                        else {
                          setSource(entry.path)
                          setRevision(suggestedName(entry.path))
                          invalidate()
                        }
                      }}
                    >
                      {entry.directory ? translateText("📁 ") : translateText("")}
                      {translateText(entry.name)}
                      {entry.bytes !== null ? translateText(" · {0} MB", { 0: (entry.bytes / 1048576).toFixed(1) }) : translateText("")}
                    </button>
                  </li>
                ))}
              </ul>
              {listing && listing.entries.length === 0 && (
                <p className="mt-2 text-xs text-muted-foreground">{translateText("Nenhum arquivo OSM/XML/gzip nesta pasta. Entre em uma subpasta ou escolha outra pasta.")}{" "}
                  <Link
                    href="/simulator/import?flow=existing"
                    className="text-primary underline"
                  >{translateText("Tenho arquivos JSON HTC")}</Link>
                  .
                </p>
              )}
              {listing?.truncated && (
                <p className="text-xs text-muted-foreground">{translateText("Lista limitada a 500 entradas. Use uma pasta mais específica.")}</p>
              )}
            </div>
          )}
          <p className="text-xs break-all">{translateText("Arquivo selecionado: ")}<strong>{translateText(source || "nenhum")}</strong>
          </p>
          <p className="text-xs text-muted-foreground">{translateText("Use .osm, .xml, .osm.gz ou .xml.gz. Um city_map.json HTC pertence ao fluxo de cenário existente. PBF ainda não é aceito.")}</p>
          <p className="text-sm text-muted-foreground">{translateText("As ruas vêm do OSM. Para conferir o funcionamento, criaremos")}{" "}
            {translateText(options.cars)}{translateText(" carros sintéticos e um teste de ")}{translateText(options.duration)}{" "}{translateText("segundos.")}</p>
          <details className="rounded-sm border border-border p-3">
            <summary className="cursor-pointer text-sm">{translateText("Ajustar carros, duração e opções avançadas")}</summary>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {(
                [
                  ["max_ways", "Limite de vias", 1, 100],
                  ["cars", "Carros sintéticos", 1, 1000],
                  ["duration", "Duração (s)", 1, undefined],
                ] as const
              ).map(([key, label, min, max]) => (
                <label key={key} className="flex flex-col gap-1 text-xs">
                  {translateText(label)}
                  <input
                    className={input}
                    type="number"
                    min={min}
                    max={max}
                    step={1}
                    value={options[key]}
                    onChange={(e) => {
                      setOptions({ ...options, [key]: Number(e.target.value) })
                      invalidate()
                    }}
                  />
                </label>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={options.allow_disconnected}
                onChange={(e) => {
                  setOptions({
                    ...options,
                    allow_disconnected: e.target.checked,
                  })
                  invalidate()
                }}
              />{translateText("Permitir partes da rede desconectadas")}</label>
            <p className="text-xs text-muted-foreground">{translateText("Perfil limitado: carros com rotas fixas, MICRO de uma faixa e velocidade padrão de 30 km/h onde ausente. Restrições não suportadas precisam ser resolvidas antes de salvar o cenário.")}</p>
          </details>
        </section>
        <section
          className="flex min-w-0 flex-col gap-3 rounded-sm border border-border bg-card p-4"
          aria-label={translateText("Área e prévia")}
        >
          <h2 className="text-base font-semibold">{translateText("2. Quais ruas deseja usar?")}</h2>
          {!source ? (
            <p className="rounded-sm border border-dashed border-border p-6 text-sm text-muted-foreground">{translateText("Escolha um arquivo na etapa 1. Depois você poderá analisar o extrato inteiro ou selecionar uma área no mapa.")}</p>
          ) : (
            <>
              <div className="flex flex-col gap-2 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="osm-area"
                    checked={areaMode === "whole"}
                    onChange={() => {
                      setAreaMode("whole")
                      invalidate()
                    }}
                  />{translateText("Usar todas as ruas deste arquivo pequeno")}</label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="osm-area"
                    checked={areaMode === "bbox"}
                    onChange={() => {
                      setAreaMode("bbox")
                      invalidate()
                    }}
                  />{translateText("Selecionar uma área de um extrato maior")}</label>
              </div>
              <p className="text-xs text-muted-foreground">{translateText("Para um arquivo de cidade ou região, aproxime o mapa e clique em “Usar área visível”. O limite deste teste é de até 100 vias OSM. As ruas azuis aparecem após a análise.")}</p>
              <PreviewMap
                report={report}
                bbox={box}
                onArea={chooseArea}
                disabled={busy}
              />
              {areaMode === "bbox" && (
                <details className="rounded-sm border border-border p-3">
                  <summary className="cursor-pointer text-xs">{translateText("Informar coordenadas da área manualmente")}</summary>
                  <div className="mt-3 grid grid-cols-2 gap-2 xl:grid-cols-4">
                    {[
                      "Oeste (lon)",
                      "Sul (lat)",
                      "Leste (lon)",
                      "Norte (lat)",
                    ].map((label, index) => (
                      <label
                        key={label}
                        className="flex flex-col gap-1 text-xs"
                      >
                        {translateText(label)}
                        <input
                          className={`${input} min-w-0`}
                          type="number"
                          step="any"
                          value={coordinates[index]}
                          onChange={(e) => {
                            setCoordinates(
                              coordinates.map((value, i) =>
                                i === index ? e.target.value : value
                              )
                            )
                            invalidate()
                          }}
                        />
                      </label>
                    ))}
                  </div>
                </details>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={!source || busy}
                  onClick={() => void startPreview()}
                >
                  {areaMode === "bbox" ? translateText("Analisar área e ver rede") : translateText("Analisar arquivo e ver rede")}
                </Button>
              </div>
            </>
          )}
        </section>
      </fieldset>

      {jobId && (
        <section
          role="status"
          aria-live="polite"
          className="rounded-sm border border-border p-3 text-xs"
        >
          <p>
            {jobBusy ? job?.status === "queued" ? translateText("Na fila…") : translateText("Processando OSM… Arquivos regionais podem levar alguns minutos.") : translateText("Operação finalizada.")}{" "}
            {jobBusy && translateText(" Você pode voltar a esta análise pelo endereço desta página.")}
          </p>
          {job?.logs && (
            <details className="mt-2">
              <summary className="cursor-pointer">{translateText("Progresso da importação")}</summary>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap">
                {job.logs}
              </pre>
            </details>
          )}
        </section>
      )}

      {report && (
        <section
          className="flex flex-col gap-3 rounded-sm border border-border bg-card p-4"
          aria-label={translateText("Relatório de importação")}
        >
          <h2 className="text-sm font-semibold">
            {report.status === "published" ? translateText("Cenário HTC criado") : report.status === "ready" ? translateText("3. Revise a rede antes de salvar") : translateText("Precisamos ajustar a seleção")}
          </h2>
          {report.network && (
            <p className="text-sm">
              {translateText(report.selection?.ways.length)}{translateText(" vias OSM ·")}{" "}
              {translateText(report.network.directed_links)}{translateText(" links direcionais ·")}{" "}
              {translateText(report.network.simulation_nodes)}{translateText(" nós ·")}{" "}
              {translateText(report.network.weak_components)}{translateText(" componente(s)")}</p>
          )}
          <ImportDiagnostics report={report} />
          {report.status === "ready" && previewId && (
            <fieldset
              disabled={busy}
              className="flex flex-wrap items-end gap-3 border-t border-border pt-3"
            >
              <legend className="text-sm font-semibold">{translateText("Salvar os arquivos de entrada HTC")}</legend>
              <label className="flex flex-col gap-1 text-xs">{translateText("Pasta onde serão salvos os cenários")}<select
                  className={input}
                  value={targetLocation}
                  onChange={(e) => setTargetLocation(e.target.value)}
                >
                  <option value="">{translateText("Escolha a pasta de destino")}</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {translateText(location.label || location.id)}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPicker("target")}
              >{translateText("Escolher outra pasta no servidor")}</Button>
              <label className="flex flex-col gap-1 text-xs">{translateText("Nome do novo cenário")}<input
                  className={input}
                  value={revision}
                  pattern="[a-z0-9][a-z0-9_-]{0,79}"
                  maxLength={80}
                  placeholder={translateText("bairro-centro-v1")}
                  onChange={(e) => setRevision(e.target.value)}
                />
              </label>
              <Button
                size="sm"
                disabled={
                  busy ||
                  !targetLocation ||
                  !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(revision)
                }
                onClick={() => void publish()}
              >{translateText("Salvar cenário HTC")}</Button>
              <p className="w-full text-xs text-muted-foreground">{translateText("A análise ainda não criou o cenário. Ao salvar, uma pasta nova será criada no destino escolhido. Use letras minúsculas, números, hífen ou sublinhado no nome.")}</p>
              {outputPath && (
                <div className="w-full rounded-sm bg-muted p-3 text-sm">
                  <p>{translateText("O cenário será criado em:")}</p>
                  <p className="mt-1 font-mono text-xs break-all">
                    {translateText(outputPath)}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">{translateText("Inclui simulation.json, data/city_map.json e JSON de nós, links e ")}{translateText(options.cars)}{translateText(" carros de teste. Um cenário existente nunca será substituído.")}</p>
                </div>
              )}
            </fieldset>
          )}
          {report.status === "published" && report.scenario_ref && (
            <div className="flex flex-col items-start gap-2">
              <p className="text-sm">{translateText(report.scenario_ref)}</p>
              <p className="text-sm text-muted-foreground">{translateText("Os arquivos HTC foram salvos. Agora execute o cenário para gerar resultados e assistir aos veículos no replay.")}</p>
              {(report.published?.directory || outputPath) && (
                <p className="font-mono text-xs break-all text-muted-foreground">
                  {translateText(report.published?.directory ?? outputPath)}
                </p>
              )}
              <Link
                className="rounded-sm bg-primary px-3 py-2 text-sm text-primary-foreground"
                href={`/simulator/runs?scenario=${encodeURIComponent(report.scenario_ref)}`}
              >{translateText("4. Executar este cenário no HTC")}</Link>
            </div>
          )}
        </section>
      )}
      {picker && (
        <FolderPicker
          start={(picker === "source" ? sourceFolder : targetFolder)?.path}
          onPick={(path) => void pickFolder(path)}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  )
}
