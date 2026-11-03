"use client"

import { useI18n } from "@/components/i18n-provider"

import { useEffect, useMemo, useState } from "react"
import "maplibre-gl/dist/maplibre-gl.css"

import { loadManifest } from "./data/loadManifest"
import {
  loadLinks,
  loadNodes,
  loadSignals,
  loadStops,
  loadRailLinks,
  loadSegments,
  buildFreeSpeedLookup,
} from "./data/loadFrames"
import { ApiReplayScenarioSource } from "./data/replayScenarioSource"
import type {
  LinksTable,
  Manifest,
  NodesTable,
  RailLinksTable,
  SegmentsTable,
  StopConfig,
  TrafficSignalConfig,
} from "./types/replay"
import { MapView, type VehicleRepresentation } from "./map/MapView"
import { SpeedLegend } from "./map/SpeedLegend"
import { useReplayPlaybackStore } from "./timeline/replayPlaybackStore"
import { useReplayPlaybackLoop } from "./timeline/useReplayPlaybackLoop"
import { ReplayTimelineScrubber } from "./timeline/ReplayTimelineScrubber"

interface StaticData {
  manifest: Manifest
  links: LinksTable
  nodes: NodesTable
  signals: TrafficSignalConfig[]
  stops: StopConfig[]
  railLinks: RailLinksTable
}

const DEFAULT_SCENARIO_ID = "htc_hybrid_demo"

function scenarioIdFromUrl(): string {
  if (typeof window === "undefined") return DEFAULT_SCENARIO_ID
  return (
    new URLSearchParams(window.location.search).get("scenario") ??
    DEFAULT_SCENARIO_ID
  )
}

const emptySegments: SegmentsTable = {
  length: 0,
  vehicleId: [],
  vehicleKind: [],
  linkId: [],
  startTick: new Float64Array(0),
  endTick: new Float64Array(0),
  lat0: new Float32Array(0),
  lon0: new Float32Array(0),
  lat1: new Float32Array(0),
  lon1: new Float32Array(0),
  startFrac: new Float32Array(0),
  endFrac: new Float32Array(0),
  speedKmh: new Float32Array(0),
  co2Grams: new Float32Array(0),
  noxGrams: new Float32Array(0),
  pm25Grams: new Float32Array(0),
}

/** Replay mode: loads a finished simulation's `segments.arrow` (+ static geometry) through the
 *  `/api/replay` bridge and plays it back over the fixed `[tickMin, tickMax]` range, reusing the
 *  exact same `MapView` rendering pipeline as the live viewer. Mirrors `htc-replay/web`'s
 *  file-replay `App`, ported into htc-ui. */
export function ReplayViewer() {
  const { t: translateText } = useI18n()

  const [scenarioId] = useState<string>(scenarioIdFromUrl)
  const [staticData, setStaticData] = useState<StaticData | null>(null)
  const [segments, setSegments] = useState<SegmentsTable | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [segmentsError, setSegmentsError] = useState<string | null>(null)
  const [representation, setRepresentation] =
    useState<VehicleRepresentation>("sprite")
  const [generating, setGenerating] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)

  // Static road-network geometry.
  useEffect(() => {
    const source = new ApiReplayScenarioSource(scenarioId)
    let cancelled = false
    setStaticData(null)
    setError(null)
    Promise.all([
      loadManifest(source),
      loadLinks(source),
      loadNodes(source),
      loadSignals(source),
      loadStops(source),
      loadRailLinks(source),
    ])
      .then(([manifest, links, nodes, signals, stops, railLinks]) => {
        if (cancelled) return
        setStaticData({ manifest, links, nodes, signals, stops, railLinks })
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [scenarioId, reloadToken])

  // Replay data — the whole finished run from segments.arrow.
  useEffect(() => {
    const source = new ApiReplayScenarioSource(scenarioId)
    let cancelled = false
    setSegments(null)
    setSegmentsError(null)
    loadSegments(source)
      .then((s) => {
        if (!cancelled) setSegments(s)
      })
      .catch((e: Error) => !cancelled && setSegmentsError(e.message))
    return () => {
      cancelled = true
    }
  }, [scenarioId, reloadToken])

  // Fixed playback range from the manifest.
  useEffect(() => {
    if (staticData) {
      useReplayPlaybackStore
        .getState()
        .setRange(staticData.manifest.tickMin, staticData.manifest.tickMax)
    }
  }, [staticData])

  const currentTick = useReplayPlaybackStore((s) => s.currentTick)
  useReplayPlaybackLoop(staticData?.manifest.ticksPerSecond ?? 1)

  const freeSpeedLookup = useMemo(
    () =>
      staticData
        ? buildFreeSpeedLookup(staticData.links)
        : new Map<string, number>(),
    [staticData]
  )

  async function handleGenerate() {
    setGenerating(true)
    setSegmentsError(null)
    try {
      const postRes = await fetch(
        `/api/replay/${encodeURIComponent(scenarioId)}`,
        { method: "POST" }
      )
      if (!postRes.ok) {
        const body = (await postRes.json().catch(() => ({}))) as {
          error?: string
        }
        throw new Error(body.error ?? `HTTP ${postRes.status}`)
      }
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 2000))
        const st = (await fetch(
          `/api/replay/${encodeURIComponent(scenarioId)}`
        ).then((r) => r.json())) as {
          status: string
          message?: string
        }
        if (st.status === "ready") {
          setReloadToken((t) => t + 1)
          return
        }
        if (st.status === "error") throw new Error(st.message ?? "ETL failed")
      }
      throw new Error("timeout esperando geração do replay")
    } catch (e) {
      setSegmentsError((e as Error).message)
    } finally {
      setGenerating(false)
    }
  }

  const generatePrompt = (
    <div style={{ textAlign: "center", maxWidth: 520 }}>
      <p>{translateText("Preparar replay para \"")}{translateText(scenarioId)}&quot;</p>
      <p style={{ opacity: 0.7, fontSize: 12, marginTop: 6 }}>
        {translateText(segmentsError ??
          error ??
          "Este run ainda não tem artefatos de replay.")}
      </p>
      <button
        onClick={handleGenerate}
        disabled={generating}
        style={{
          marginTop: 14,
          padding: "6px 16px",
          borderRadius: 6,
          background: "#2ecc71",
          color: "white",
          border: "none",
          cursor: "pointer",
          fontWeight: 600,
          opacity: generating ? 0.6 : 1,
        }}
      >
        {generating ? translateText("Gerando…") : translateText("Gerar replay")}
      </button>
      {scenarioId.startsWith("simedape-") && (
        <p style={{ marginTop: 12 }}>
          <a href="/simedape">{translateText("Voltar aos runs HTC")}</a>
        </p>
      )}
    </div>
  )

  if (error) return <CenteredMessage>{translateText(generatePrompt)}</CenteredMessage>
  if (!staticData) {
    return (
      <CenteredMessage>{translateText("Carregando cenário \"")}{translateText(scenarioId)}&quot;…
      </CenteredMessage>
    )
  }

  return (
    <div className="absolute inset-0">
      <MapView
        links={staticData.links}
        nodes={staticData.nodes}
        signals={staticData.signals}
        stops={staticData.stops}
        railLinks={staticData.railLinks}
        segments={segments ?? emptySegments}
        boundingBox={staticData.manifest.boundingBox}
        currentTick={currentTick}
        hasEmissions={staticData.manifest.hasEmissions}
        emissionKind="co2Grams"
        representation={representation}
        freeSpeedLookup={freeSpeedLookup}
      />
      <ReplayStatusBadge
        tick={currentTick}
        tickMax={staticData.manifest.tickMax}
        vehicleCount={segments?.length ?? 0}
        scenarioId={scenarioId}
      />
      <SpeedLegend />
      <ReplayTimelineScrubber />
      <div
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          padding: "6px 10px",
          background: "rgba(20,20,24,0.78)",
          color: "white",
          borderRadius: 6,
          fontSize: 12,
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>{translateText("Veículos (zoom in):")}</span>
          <select
            value={representation}
            onChange={(e) =>
              setRepresentation(e.target.value as VehicleRepresentation)
            }
          >
            <option value="sprite">{translateText("Desenhos · escala da via")}</option>
            <option value="shape">{translateText("Forma + cor por velocidade")}</option>
            <option value="circle">{translateText("Só cor por velocidade")}</option>
          </select>
        </label>
      </div>
      {!segments && (
        <CenteredMessage>
          {segmentsError ? generatePrompt : <p>{translateText("Carregando segmentos…")}</p>}
        </CenteredMessage>
      )}
    </div>
  )
}

function ReplayStatusBadge({
  tick,
  tickMax,
  vehicleCount,
  scenarioId,
}: {
  tick: number
  tickMax: number
  vehicleCount: number
  scenarioId: string
}) {
  const { t: translateText, intlLocale } = useI18n()

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: 12,
        padding: "6px 10px",
        background: "rgba(20,20,24,0.78)",
        color: "white",
        borderRadius: 6,
        fontSize: 12,
      }}
    >{translateText("replay · tick ")}{translateText(Math.round(tick).toLocaleString(intlLocale))} /{" "}
      {translateText(Math.round(tickMax).toLocaleString(intlLocale))} · {translateText(vehicleCount)}{translateText(" segmentos")}<div style={{ fontSize: 10, marginTop: 4 }}>{translateText(scenarioId)}</div>
    </div>
  )
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  

  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center text-sm text-muted-foreground"
      style={{ background: "#111" }}
    >
      {children}
    </div>
  )
}
