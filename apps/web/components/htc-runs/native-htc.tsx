"use client"

import { useI18n } from "@/components/i18n-provider"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@workspace/ui/components/button"
import {
  getNativeCatalogue,
  getNativeSeries,
  nativeArtifactUrl,
  startNativeRun,
  type NativeCatalogue,
  type NativeResults,
  type NativeSeries,
} from "@/lib/simedape-api"

const inputClass =
  "h-8 rounded-sm border border-input bg-background px-2 text-xs"

export function NativeHTCStart({
  onStarted,
}: {
  onStarted: (id: string) => void
}) {
  const { t: translateText } = useI18n()

  const router = useRouter()
  const [catalogue, setCatalogue] = useState<NativeCatalogue | null>(null)
  const [scenario, setScenario] = useState("")
  const [bin, setBin] = useState(5)
  const [busy, setBusy] = useState(false)
  const [live, setLive] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    try {
      const data = await getNativeCatalogue()
      setCatalogue(data)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  useEffect(() => {
    let active = true
    getNativeCatalogue()
      .then((data) => {
        if (active) {
          setCatalogue(data)
          const requested = new URLSearchParams(window.location.search).get(
            "scenario"
          )
          if (requested) {
            setScenario(
              data.scenarios.some(
                (item) => item.name === requested && item.supported
              )
                ? requested
                : ""
            )
          }
        }
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
    return () => {
      active = false
    }
  }, [])

  async function start() {
    setBusy(true)
    setError(null)
    try {
      const started = await startNativeRun(scenario, bin, live)
      onStarted(started.run_id)
      if (started.live_url) router.push(started.live_url)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className="flex flex-col gap-3 rounded-sm border p-4"
      aria-label={translateText("HTC native execution")}
    >
      <h2 className="text-sm font-semibold">{translateText("HTC · execução completa")}</h2>
      <p className="text-xs text-muted-foreground">{translateText("Execute HTC e explore medições por link. Cenários JSON com carros independentes em links MICRO, MESO ou mistos; resultados da execução completa.")}</p>
      {scenario && (
        <p className="text-xs text-muted-foreground">
          {translateText(catalogue?.scenarios.find((s) => s.name === scenario)?.title)}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={live}
            disabled={busy || (!catalogue?.live?.ready && !live)}
            onChange={(event) => setLive(event.target.checked)}
          />{translateText("Acompanhar este run ao vivo")}</label>
        <label className="flex flex-col gap-1 text-xs">{translateText("Cenário HTC")}<select
            aria-label={translateText("Cenário HTC")}
            className={inputClass}
            value={scenario}
            onChange={(e) => setScenario(e.target.value)}
          >
            <option value="">{translateText("Selecione um cenário")}</option>
            {Object.entries(
              (catalogue?.scenarios ?? []).reduce<
                Record<string, NonNullable<typeof catalogue>["scenarios"]>
              >((groups, s) => {
                const key = s.location_label ?? "Cenários"
                ;(groups[key] ??= []).push(s)
                return groups
              }, {})
            ).map(([group, items]) => (
              <optgroup key={group} label={translateText(group)}>
                {items.map((s) => (
                  <option key={s.name} value={s.name} disabled={!s.supported}>
                    {s.location ? translateText(s.name.slice(s.location.length + 1)) : translateText(s.name)}
                    {s.map_mode === "osm" ? translateText(" · OSM") : translateText("")}
                    {s.simulation_modes?.length ? translateText(" · {0}", { 0: s.simulation_modes.join(" + ") }) : translateText("")}
                    {s.requires_fetch ? translateText(" · remoto") : translateText("")}
                    {s.supported ? translateText("") : translateText(" · incompatível")}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">{translateText("Intervalo (s)")}<input
            aria-label={translateText("Intervalo de agregação")}
            className={`${inputClass} w-24`}
            type="number"
            min={1}
            max={300}
            value={bin}
            onChange={(e) => setBin(Number(e.target.value))}
          />
        </label>
        <Button
          size="sm"
          disabled={
            busy ||
            !scenario ||
            !catalogue?.engine_ready ||
            (live && !catalogue?.live?.ready)
          }
          onClick={start}
        >
          {busy ? translateText("A iniciar…") : live ? translateText("Abrir ao vivo e executar HTC") : translateText("Executar HTC")}
        </Button>
        <Button size="sm" variant="ghost" onClick={refresh}>{translateText("Atualizar cenários")}</Button>
      </div>
      {live && (
        <p className="text-xs text-muted-foreground">{translateText("A página ao vivo será aberta. O HTC só começa depois de carregar a geometria e confirmar a conexão deste run. Resultados e replay continuam disponíveis ao terminar.")}</p>
      )}
      {catalogue?.live?.configured && !catalogue.live.ready && (
        <p className="text-xs text-muted-foreground">{translateText("O serviço ao vivo está indisponível. Atualize o catálogo para tentar novamente; a execução com replay continua disponível.")}</p>
      )}
      {catalogue && !catalogue.live?.configured && (
        <p className="text-xs text-muted-foreground">{translateText("Este servidor ainda não disponibiliza acompanhamento ao vivo. Você pode executar e abrir o replay ao terminar.")}</p>
      )}
      {catalogue && !catalogue.engine_ready && (
        <p className="text-xs text-destructive">{translateText("Engine indisponível. Configure SIMEDAPE_HTC_ENGINE_JAR no servidor.")}</p>
      )}
      {catalogue?.scenarios.length === 0 && (
        <p className="text-xs text-muted-foreground">{translateText("Nenhum cenário encontrado. Adicione um local em Locais (ou defina SIMEDAPE_HTC_SCENARIOS_DIR no servidor).")}</p>
      )}
      {catalogue?.scenarios
        .filter((s) => !s.supported)
        .map((s) => (
          <p key={s.name} className="text-xs text-muted-foreground">
            {translateText(s.name)}: {translateText(s.reason)}
          </p>
        ))}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {translateText(error)}
        </p>
      )}
    </section>
  )
}

export function NativeHTCResults({
  runId,
  result,
}: {
  runId: string
  result: NativeResults
}) {
  const { t: translateText } = useI18n()

  const [index, setIndex] = useState(0)
  const [variable, setVariable] = useState(result.variables[0] ?? "count")
  const [response, setResponse] = useState<{
    key: string
    data?: NativeSeries
    error?: string
  } | null>(null)
  const requestKey = `${runId}:${index}:${variable}`
  const data = response?.key === requestKey ? response.data : null
  const error = response?.key === requestKey ? response.error : null
  useEffect(() => {
    let active = true
    getNativeSeries(runId, index, variable)
      .then((data) => {
        if (active) setResponse({ key: requestKey, data })
      })
      .catch((e) => {
        if (active) setResponse({ key: requestKey, error: e.message })
      })
    return () => {
      active = false
    }
  }, [runId, index, variable, requestKey])

  const present = data?.values.filter((v): v is number => v !== null) ?? []
  const min = present.length ? Math.min(...present) : 0
  const max = present.length ? Math.max(...present) : 1
  // Separate paths preserve gaps rather than drawing through missing observations.
  const paths: string[] = []
  data?.values.forEach((v, i) => {
    if (v === null) return
    const point = `${40 + (i * 740) / Math.max(1, data.values.length - 1)},${160 - ((v - min) * 130) / (max - min || 1)}`
    if (i === 0 || data.values[i - 1] === null) paths.push(`M${point}`)
    else paths[paths.length - 1] += ` L${point}`
  })
  return (
    <div className="flex flex-col gap-3 text-xs">
      {result.replay?.available && (
        <a
          className="w-fit rounded-sm border px-3 py-2 font-semibold text-primary"
          href={`/simulator/replay?scenario=${encodeURIComponent(result.replay.scenario_id)}`}
        >{translateText("Abrir replay deste run")}</a>
      )}
      {result.replay && !result.replay.available && (
        <p className="text-muted-foreground">{translateText("Replay indisponível:")}{" "}
          {translateText(result.replay.reason ??
            "Execute um novo run para verificar a disponibilidade de replay.")}
        </p>
      )}
      <p>{translateText("HTC completo · ")}{translateText(result.series.length)}{translateText(" séries · ")}{translateText(result.observed_values)}/
        {translateText(result.total_values)}{translateText(" valores observados")}</p>
      <p className="text-muted-foreground">{translateText("Resultados medidos após confirmação de conclusão do HTC. Valores ausentes aparecem como “—”. Count representa ocupação média no intervalo; flow representa saídas/s.")}</p>
      {result.simulation_modes?.includes("MESO") && (
        <p className="text-muted-foreground">{translateText("Links MESO: velocidade média calculada pela distância e duração de travessias concluídas. Aceleração, desaceleração e gap microscópicos ficam ausentes. A velocidade de travessias incompletas também fica ausente. Em redes mistas, os links MICRO mantêm suas medições microscópicas.")}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <select
          aria-label={translateText("Série medida")}
          className={inputClass}
          value={index}
          onChange={(e) => setIndex(Number(e.target.value))}
        >
          {result.series.map((s) => (
            <option key={s.index} value={s.index}>
              {translateText(s.label)}
            </option>
          ))}
        </select>
        <select
          aria-label={translateText("Variável medida")}
          className={inputClass}
          value={variable}
          onChange={(e) => setVariable(e.target.value)}
        >
          {result.variables.map((v) => (
            <option key={v} value={v}>
              {translateText(v)} ({translateText(result.variable_units[v])})
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {translateText(error)}
        </p>
      )}
      {data && (
        <>
          <svg
            viewBox="0 0 800 200"
            className="w-full max-w-4xl text-primary"
            role="img"
            aria-label={translateText("{0} por tempo em segundos; unidade {1}", { 0: variable, 1: data.unit })}
          >
            <path
              d="M40,20 V160 H780"
              fill="none"
              stroke="currentColor"
              opacity="0.3"
            />
            {paths.map((d, i) => (
              <path
                key={i}
                d={d}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              />
            ))}
            <text x="40" y="15" fill="currentColor" fontSize="11">
              {translateText(variable)} ({translateText(data.unit)}) · {translateText(min.toFixed(3))}–{translateText(max.toFixed(3))}
            </text>
            <text x="40" y="182" fill="currentColor" fontSize="11">
              0
            </text>
            <text x="700" y="182" fill="currentColor" fontSize="11">
              {translateText(data.times.at(-1))}{translateText(" s")}</text>
          </svg>
          <div className="max-h-64 overflow-auto rounded-sm border">
            <table className="w-full text-left">
              <thead>
                <tr>
                  <th className="p-2">{translateText("Tempo (s)")}</th>
                  <th className="p-2">
                    {translateText(variable)} ({translateText(data.unit)})
                  </th>
                  <th className="p-2">{translateText("Observado")}</th>
                </tr>
              </thead>
              <tbody>
                {data.times.map((t, i) => (
                  <tr key={t} className="border-t">
                    <td className="p-2">{translateText(t)}</td>
                    <td className="p-2">{translateText(data.values[i]?.toFixed(4) ?? "—")}</td>
                    <td className="p-2">{data.observed[i] ? translateText("sim") : translateText("não")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="flex flex-wrap gap-3">
        {result.artifacts.map((file) => (
          <a
            key={file}
            className="text-primary underline"
            href={nativeArtifactUrl(runId, file)}
          >
            {translateText(file)}
          </a>
        ))}
      </div>
    </div>
  )
}
