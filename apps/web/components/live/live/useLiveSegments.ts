import { useEffect, useMemo, useRef, useState } from "react"
import type { LinksTable, NodesTable, RailLinksTable, SegmentsTable } from "../types/replay"
import type { LiveConnectionState, LiveEnvelope } from "../types/live"
import { LiveSegmentStore } from "./liveSegmentStore"
import { LiveTransitStore } from "./liveTransitStore"
import { parseStreamFrame, type StreamReady } from "@/lib/native-live"

/** How often to rebuild the `SegmentsTable` snapshot from the live store and push a React
 * re-render, in milliseconds. Deliberately *not* on every single incoming WebSocket message:
 * MICRO `micro_update` events alone can arrive several times a second per vehicle even after
 * the engine-side throttle (`htc.report-manager.kafka.micro-update-report-every`), and
 * `snapshot()` rebuilds the whole typed-array set from scratch (O(segments)) — same
 * "batch, don't stream per-event into the render path" principle already applied by
 * `useVehicleWorker`'s worker-side buffering. A future iteration could make `useVehicleWorker`
 * itself accept incremental appends instead of a full dataset swap; out of scope for this pass
 * — see project memory on htc-replay live mode.
 */
const SNAPSHOT_INTERVAL_MS = 500

export interface LiveSegmentsResult {
  segments: SegmentsTable
  latestTick: number
  connectionState: LiveConnectionState
  transit?: LiveTransitStore
}

const EMPTY_SEGMENTS: SegmentsTable = {
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

/** Connects to htc-bus-live's `/ws/live` WebSocket and maintains a `SegmentsTable` snapshot
 * that the exact same rendering pipeline (`useVehicleWorker`, `MapView`) consumes whether it
 * came from a static Arrow file or this incremental live feed — the extension point
 * `docs/ARCHITECTURE.md` named when file-replay-only v1 shipped.
 *
 * Reconnects with a fixed backoff on any close/error; the live store itself is *not* reset on
 * reconnect (a brief network blip shouldn't wipe segments the viewer already has).
 */
export function useLiveSegments(
  wsUrl: string,
  links: LinksTable,
  nodes: NodesTable,
  ticksPerSecond: number,
  options: {
    enabled?: boolean
    simulationId?: string
    windowTicks?: number
    railLinks?: RailLinksTable
    onReady?: (frame: StreamReady) => void
  } = {}
): LiveSegmentsResult {
  const store = useMemo(
    () =>
      options.enabled === false
        ? null
        : new LiveSegmentStore(
            links,
            nodes,
            ticksPerSecond,
            options.windowTicks,
            options.simulationId,
            options.railLinks
          ),
    [links, nodes, ticksPerSecond, options.enabled, options.simulationId, options.railLinks, options.windowTicks]
  )
  const [snapshot, setSnapshot] = useState<{
    store: LiveSegmentStore | null
    segments: SegmentsTable
    latestTick: number
  }>({ store: null, segments: EMPTY_SEGMENTS, latestTick: 0 })
  const transit = useMemo(() => store ? new LiveTransitStore(options.simulationId, options.windowTicks) : undefined,
    [store, options.simulationId, options.windowTicks])
  const [connectionState, setConnectionState] =
    useState<LiveConnectionState>("connecting")

  const readyRef = useRef(options.onReady)
  useEffect(() => {
    readyRef.current = options.onReady
  }, [options.onReady])

  useEffect(() => {
    if (!store) return
    let cancelled = false
    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    const connect = () => {
      if (cancelled) return
      setConnectionState("connecting")
      socket = new WebSocket(wsUrl)

      socket.onopen = () => {
        if (!cancelled) setConnectionState("open")
      }

      socket.onmessage = (event: MessageEvent<string>) => {
        if (cancelled) return
        try {
          const frame = parseStreamFrame(event.data, options.simulationId)
          if (!frame) return
          if ("type" in frame) readyRef.current?.(frame as StreamReady)
          else {
            store.ingest(frame as LiveEnvelope)
            transit?.ingest(frame as LiveEnvelope)
          }
        } catch {
          // Malformed frame — drop it. A single bad message must never take down the
          // live viewer; the next frame is independent (matches the engine's own
          // best-effort, no-blocking reporting discipline one hop further down the pipe).
        }
      }

      socket.onerror = () => {
        if (!cancelled) setConnectionState("error")
      }

      socket.onclose = () => {
        if (cancelled) return
        setConnectionState("closed")
        reconnectTimer = setTimeout(connect, 2000)
      }
    }

    connect()

    return () => {
      cancelled = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [wsUrl, store, transit, options.simulationId])

  useEffect(() => {
    if (!store) return
    const interval = setInterval(() => {
      setSnapshot({
        store,
        segments: store.snapshot(),
        latestTick: store.getLatestTick(),
      })
    }, SNAPSHOT_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [store])

  return {
    segments: snapshot.store === store ? snapshot.segments : EMPTY_SEGMENTS,
    latestTick: snapshot.store === store ? snapshot.latestTick : 0,
    connectionState,
    transit: snapshot.store === store ? transit : undefined,
  }
}
