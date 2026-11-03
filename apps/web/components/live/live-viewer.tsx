"use client"

import { useI18n } from "@/components/i18n-provider"

import { useEffect, useMemo, useState } from "react"
import "maplibre-gl/dist/maplibre-gl.css"

import { loadManifest } from "./data/loadManifest"
import { loadLinks, loadNodes, loadSignals, loadStops, loadRailLinks, buildFreeSpeedLookup } from "./data/loadFrames"
import { ApiReplayScenarioSource } from "./data/replayScenarioSource"
import { listBundledScenarios } from "./data/listBundledScenarios"
import type { LinksTable, Manifest, NodesTable, RailLinksTable, StopConfig, TrafficSignalConfig } from "./types/replay"
import { MapView, type VehicleRepresentation } from "./map/MapView"
import { SpeedLegend } from "./map/SpeedLegend"
import { useLiveSegments } from "./live/useLiveSegments"
import { useLivePlaybackStore } from "./timeline/livePlaybackStore"
import { useLivePlaybackLoop } from "./timeline/useLivePlaybackLoop"
import { LiveTimelineScrubber } from "./timeline/LiveTimelineScrubber"
import { LIVE_WS_URL } from "@/lib/live-config"

interface StaticData {
  manifest: Manifest
  links: LinksTable
  nodes: NodesTable
  signals: TrafficSignalConfig[]
  stops: StopConfig[]
  railLinks: RailLinksTable
}

const DEFAULT_SCENARIO_ID = "htc_hybrid_demo"

/** Geometry comes from bundled artifacts or a geometry-only ETL of a mounted scenario. */
function scenarioIdFromUrl(): string {
  if (typeof window === "undefined") return DEFAULT_SCENARIO_ID
  return new URLSearchParams(window.location.search).get("scenario") ?? DEFAULT_SCENARIO_ID
}

const emptyNodes: NodesTable = { length: 0, nodeId: [], lat: new Float32Array(0), lon: new Float32Array(0), hasSignal: new Int32Array(0) }
const emptyLinks: LinksTable = {
  length: 0,
  linkId: [],
  lat0: new Float32Array(0),
  lon0: new Float32Array(0),
  lat1: new Float32Array(0),
  lon1: new Float32Array(0),
  lengthM: new Float32Array(0),
  lanes: new Int32Array(0),
  simulationMode: [],
  freeSpeedKmh: new Float32Array(0),
}

export function LiveViewer() {
  const { t: translateText } = useI18n()

  const [scenarioId, setScenarioId] = useState<string>(scenarioIdFromUrl)
  const [bundledScenarios, setBundledScenarios] = useState<string[]>([])
  const [staticData, setStaticData] = useState<StaticData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [representation, setRepresentation] = useState<VehicleRepresentation>("sprite")

  useEffect(() => {
    listBundledScenarios().then(setBundledScenarios)
  }, [])

  useEffect(() => {
    const source = new ApiReplayScenarioSource(scenarioId, true)
    let cancelled = false
    setStaticData(null)
    setError(null)
    const prepare = async () => {
      if (await source.fetchText("manifest.json") !== null) return
      const endpoint = `/api/replay/${encodeURIComponent(scenarioId)}?mode=live`
      const started = await fetch(endpoint, { method: "POST" })
      const result = await started.json()
      if (!started.ok) throw new Error(result.error ?? result.message ?? "Geometry generation failed")
      for (let i = 0; i < 600 && !cancelled; i++) {
        const response = await fetch(endpoint)
        const state = await response.json()
        if (state.status === "ready") return
        if (!response.ok || state.status === "error") throw new Error(state.message ?? state.error ?? "Geometry generation failed")
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
      if (!cancelled) throw new Error("Geometry generation timed out")
    }
    prepare().then(() => Promise.all([
      loadManifest(source),
      loadLinks(source),
      loadNodes(source),
      loadSignals(source),
      loadStops(source),
      loadRailLinks(source),
    ]))
      .then(([manifest, links, nodes, signals, stops, railLinks]) => {
        if (cancelled) return
        setStaticData({ manifest, links, nodes, signals, stops, railLinks })
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [scenarioId])

  const { segments, latestTick, connectionState, transit } = useLiveSegments(
    `${LIVE_WS_URL}${LIVE_WS_URL.includes("?") ? "&" : "?"}simulationId=${encodeURIComponent(scenarioId)}`,
    staticData?.links ?? emptyLinks,
    staticData?.nodes ?? emptyNodes,
    staticData?.manifest.ticksPerSecond ?? 1,
    { enabled: !!staticData, simulationId: scenarioId, railLinks: staticData?.railLinks }
  )

  const currentTick = useLivePlaybackStore((s) => s.currentTick)

  // Drive the human-controlled visualization clock (play/pause/scrub/speed). The segment
  // store still ingests at the socket's arrival rate; this clock just controls *when* we look
  // at that buffer.
  useLivePlaybackLoop(staticData?.manifest.ticksPerSecond ?? 1)

  // The live edge (highest tick seen so far) is the playback clock's ceiling.
  useEffect(() => {
    useLivePlaybackStore.getState().setTickMax(latestTick)
  }, [latestTick])

  // Switching scenarios re-creates the segment store and starts a fresh clock.
  useEffect(() => {
    useLivePlaybackStore.getState().reset()
  }, [scenarioId])

  const freeSpeedLookup = useMemo(
    () => (staticData ? buildFreeSpeedLookup(staticData.links) : new Map<string, number>()),
    [staticData]
  )

  function handleScenarioChange(id: string) {
    setScenarioId(id)
    const params = new URLSearchParams(window.location.search)
    params.set("scenario", id)
    window.history.replaceState(null, "", `?${params.toString()}`)
  }

  if (error) {
    return <CenteredMessage>{translateText("Erro ao carregar geometria do cenário \"")}{translateText(scenarioId)}&quot;: {translateText(error)}</CenteredMessage>
  }
  if (!staticData) {
    return <CenteredMessage>{translateText("Carregando geometria do cenário \"")}{translateText(scenarioId)}&quot;…</CenteredMessage>
  }

  return (
    <div className="absolute inset-0">
      <MapView
        links={staticData.links}
        nodes={staticData.nodes}
        signals={staticData.signals}
        stops={staticData.stops}
        railLinks={staticData.railLinks}
        segments={segments}
        transit={transit}
        transitConnection={connectionState}
        boundingBox={staticData.manifest.boundingBox}
        currentTick={currentTick}
        hasEmissions={false}
        emissionKind="co2Grams"
        representation={representation}
        freeSpeedLookup={freeSpeedLookup}
      />
      <LiveStatusBadge connectionState={connectionState} tick={currentTick} edgeTick={latestTick} vehicleCount={segments.length} />
      <SpeedLegend />
      <LiveTimelineScrubber />
      <ScenarioControls
        scenarioId={scenarioId}
        bundledScenarios={bundledScenarios}
        onScenarioChange={handleScenarioChange}
        representation={representation}
        onRepresentationChange={setRepresentation}
      />
    </div>
  )
}

function ScenarioControls({
  scenarioId,
  bundledScenarios,
  onScenarioChange,
  representation,
  onRepresentationChange,
}: {
  scenarioId: string
  bundledScenarios: string[]
  onScenarioChange: (id: string) => void
  representation: VehicleRepresentation
  onRepresentationChange: (r: VehicleRepresentation) => void
}) {
  const { t: translateText } = useI18n()

  const options = [...new Set([scenarioId, ...bundledScenarios])]
  return (
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
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span>{translateText("Geometria (cenário):")}</span>
        <select value={scenarioId} onChange={(e) => onScenarioChange(e.target.value)}>
          {options.map((id) => (
            <option key={id} value={id}>
              {translateText(id)}
            </option>
          ))}
        </select>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span>{translateText("Veículos (zoom in):")}</span>
        <select value={representation} onChange={(e) => onRepresentationChange(e.target.value as VehicleRepresentation)}>
          <option value="sprite">{translateText("Desenhos · escala da via")}</option>
          <option value="shape">{translateText("Forma + cor por velocidade")}</option>
          <option value="circle">{translateText("Só cor por velocidade")}</option>
        </select>
      </div>
    </div>
  )
}

function LiveStatusBadge({
  connectionState,
  tick,
  edgeTick,
  vehicleCount,
}: {
  connectionState: string
  tick: number
  edgeTick: number
  vehicleCount: number
}) {
  const { t: translateText, intlLocale } = useI18n()

  const color = connectionState === "open" ? "#2ecc71" : connectionState === "connecting" ? "#f1c40f" : "#e74c3c"
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
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block" }} />
      <span>{translateText("live · ")}{translateText(connectionState)}{translateText(" · tick ")}{Math.round(tick).toLocaleString(intlLocale)} / {Math.round(edgeTick).toLocaleString(intlLocale)} · {vehicleCount}{translateText(" segmentos ativos")}</span>
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
