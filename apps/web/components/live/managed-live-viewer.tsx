"use client"

import { useI18n } from "@/components/i18n-provider"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { MapView, type VehicleRepresentation } from "./map/MapView"
import { SpeedLegend } from "./map/SpeedLegend"
import { useLiveSegments } from "./live/useLiveSegments"
import { useLivePlaybackStore } from "./timeline/livePlaybackStore"
import { useLivePlaybackLoop } from "./timeline/useLivePlaybackLoop"
import { LiveTimelineScrubber } from "./timeline/LiveTimelineScrubber"
import { buildFreeSpeedLookup } from "./data/loadFrames"
import {
  liveRequest,
  loadLiveGeometry,
  type NativeLiveDescriptor,
  type StreamReady,
} from "@/lib/native-live"
import type { RailLinksTable } from "./types/replay"
import { useMemo } from "react"

const emptyRail: RailLinksTable = {
  length: 0,
  linkId: [],
  lat0: new Float32Array(),
  lon0: new Float32Array(),
  lat1: new Float32Array(),
  lon1: new Float32Array(),
  lengthM: new Float32Array(),
  lanes: new Int32Array(),
  freeSpeedKmh: new Float32Array(),
  railType: [],
  subwayLine: [],
}

export function ManagedLiveViewer({ runId }: { runId: string }) {
  const { t: translateText } = useI18n()

  const [descriptor, setDescriptor] = useState<NativeLiveDescriptor | null>(
    null
  )
  const [geometry, setGeometry] = useState<Awaited<
    ReturnType<typeof loadLiveGeometry>
  > | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const data = await liveRequest<NativeLiveDescriptor>(
          `/api/runs/${runId}/native/live`
        )
        if (!active) return
        if (data.run_id !== runId)
          throw new Error("Live descriptor belongs to another run")
        setDescriptor(data)
        if (
          data.state === "failed" ||
          data.status === "failed" ||
          data.status === "cancelled"
        )
          throw new Error(data.error ?? "Live run failed or was cancelled")
        if (data.geometry_sha256) {
          // Revalidate the immutable geometry before mounting the socket/store for this run.
          const loaded = await loadLiveGeometry(data)
          if (!active) return
          setGeometry((current) => current ?? loaded)
        }
        setError(null)
      } catch (e) {
        if (active) setError((e as Error).message)
      }
      if (active) timer = setTimeout(() => void poll(), 2000)
    }
    void poll()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [runId])

  if (error && !geometry)
    return (
      <div className="p-6 text-sm" role="alert">
        <p>{translateText(error)}</p>
        <Link
          href={`/simulator/runs?run=${runId}`}
          className="text-primary underline"
        >{translateText("Voltar às execuções")}</Link>
      </div>
    )
  if (!geometry || !descriptor?.ws_url)
    return (
      <p className="p-6 text-sm" role="status">{translateText("Preparando a geometria deste run. O HTC aguarda a conexão do viewer…")}</p>
    )
  return (
    <>
      <ReadyLiveMap runId={runId} descriptor={descriptor} geometry={geometry} />
      {error && (
        <p
          role="alert"
          className="absolute bottom-20 left-3 rounded-sm bg-card p-3 text-xs"
        >
          {translateText(error)}
        </p>
      )}
    </>
  )
}

function ReadyLiveMap({
  runId,
  descriptor,
  geometry,
}: {
  runId: string
  descriptor: NativeLiveDescriptor
  geometry: Awaited<ReturnType<typeof loadLiveGeometry>>
}) {
  const { t: translateText } = useI18n()

  const [acknowledged, setAcknowledged] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [representation, setRepresentation] =
    useState<VehicleRepresentation>("sprite")
  const [rendererReady, setRendererReady] = useState(false)
  const [session, setSession] = useState<StreamReady | null>(null)
  const ready = useCallback((frame: StreamReady) => setSession(frame), [])
  const live = useLiveSegments(
    descriptor.ws_url!,
    geometry.links,
    geometry.nodes,
    geometry.raw.ticks_per_second,
    { simulationId: runId, onReady: ready }
  )
  useEffect(() => {
    if (
      !rendererReady ||
      !session ||
      live.connectionState !== "open" ||
      descriptor.status !== "running"
    )
      return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const acknowledge = async () => {
      try {
        await liveRequest(descriptor.ready_url!, {
          ...session,
          readiness_token: descriptor.readiness_token,
          geometry_sha256: descriptor.geometry_sha256,
        })
        if (active) {
          setAcknowledged(true)
          setError(null)
        }
      } catch (failure) {
        if (active) {
          setError((failure as Error).message)
          timer = setTimeout(() => void acknowledge(), 1000)
        }
      }
    }
    void acknowledge()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [
    rendererReady,
    session,
    live.connectionState,
    descriptor.status,
    descriptor.ready_url,
    descriptor.readiness_token,
    descriptor.geometry_sha256,
  ])
  const currentTick = useLivePlaybackStore((state) => state.currentTick)
  useLivePlaybackLoop(geometry.raw.ticks_per_second)
  useEffect(() => {
    useLivePlaybackStore.getState().reset()
  }, [runId])
  useEffect(() => {
    useLivePlaybackStore.getState().setTickMax(live.latestTick)
  }, [live.latestTick])
  const speeds = useMemo(
    () => buildFreeSpeedLookup(geometry.links),
    [geometry.links]
  )
  return (
    <div className="absolute inset-0">
      <MapView
        links={geometry.links}
        nodes={geometry.nodes}
        signals={geometry.raw.signals}
        stops={[]}
        railLinks={emptyRail}
        segments={live.segments}
        boundingBox={geometry.raw.bounds}
        currentTick={currentTick}
        hasEmissions={false}
        emissionKind="co2Grams"
        representation={representation}
        freeSpeedLookup={speeds}
        onReady={() => setRendererReady(true)}
      />
      <div
        className="absolute top-3 right-3 left-3 flex flex-wrap items-center gap-3 rounded-sm border border-border bg-card p-3 text-xs"
        role="status"
      >
        <span>{translateText("Run ")}{translateText(runId.slice(0, 8))} ·{" "}
          {descriptor.state === "completed" ? translateText("Concluído") : acknowledged ? translateText("Conectado ao run") : translateText("Confirmando conexão…")}
        </span>
        <span>{translateText("Stream: ")}{translateText(live.connectionState)}{translateText(" · tick ")}{live.latestTick}{translateText(" · segmentos")}{" "}
          {live.segments.length}
        </span>
        <span>{translateText("Links: ")}{translateText([...new Set(geometry.links.simulationMode)].sort().join(" + "))}
        </span>
        <label>{translateText("Veículos")}{" "}
          <select
            aria-label={translateText("Representação dos veículos")}
            value={representation}
            onChange={(event) =>
              setRepresentation(event.target.value as VehicleRepresentation)
            }
            className="rounded-sm border border-input bg-background p-1"
          >
            <option value="sprite">{translateText("Desenhos · escala da via")}</option>
            <option value="circle">{translateText("Círculo / worker")}</option>
            <option value="shape">{translateText("Forma")}</option>
          </select>
        </label>
        <Link
          href={`/simulator/runs?run=${runId}`}
          className="text-primary underline"
        >{translateText("Resultados")}</Link>
        {descriptor.state === "completed" && (
          <Link
            href={`/simulator/replay?scenario=simedape-${runId}`}
            className="text-primary underline"
          >{translateText("Replay completo")}</Link>
        )}
        {error && (
          <span role="alert" className="text-destructive">
            {translateText(error)}
          </span>
        )}
        {live.connectionState !== "open" && acknowledged && (
          <span>{translateText("Conexão interrompida; retomando. Eventos perdidos ficam disponíveis no replay completo.")}</span>
        )}
        {descriptor.state === "completed" && !live.segments.length && (
          <span>{translateText("O run já terminou. Abra o replay para ver toda a execução.")}</span>
        )}
      </div>
      <SpeedLegend />
      <LiveTimelineScrubber />
    </div>
  )
}
