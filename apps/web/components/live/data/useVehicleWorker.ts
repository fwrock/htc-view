import { useEffect, useRef, useState } from "react"
import type { SegmentsTable } from "../types/replay"
import {
  buildSegmentBuffers,
  segmentBufferTransferList,
} from "../workers/segmentBuffers"
import type { Bounds } from "../workers/spatialGrid"
import type { IndexedRoad } from "../map/roadGeometry"

export interface WorkerFrame {
  count: number
  positions: Float32Array
  colors: Uint8Array
  weights: Float32Array
  truncated: boolean
  /** Monotonic counter, bumped on every accepted frame — a stable `updateTriggers` value for
   * deck.gl layers, since the typed arrays themselves are always fresh objects each frame. */
  version: number
}

/** Drives the vehicle-position Web Worker: (re)builds it whenever the dataset changes, and
 * requests one frame per `currentTick`/`bounds` change — skipping the request if the worker
 * is still computing the previous one (adaptive frame rate under heavy load rather than
 * queueing up stale work) and discarding any response that arrives after a newer request has
 * already been sent (a slow response to an old tick must never overwrite a newer one).
 */
export function useVehicleWorker(
  segments: SegmentsTable,
  freeSpeedLookup: Map<string, number>,
  currentTick: number,
  bounds: Bounds | null,
  roads?: Map<string, IndexedRoad>,
  laneCounts?: Map<string, number>
): WorkerFrame | null {
  const workerRef = useRef<Worker | null>(null)
  const readyRef = useRef(false)
  const busyRef = useRef(false)
  const nextRequestId = useRef(0)
  const latestRequestId = useRef(0)
  const [frame, setFrame] = useState<WorkerFrame | null>(null)
  const frameVersion = useRef(0)
  // Bumped when the worker finishes indexing the dataset — nothing else changes at that
  // moment, so without this the frame-request effect below (keyed on tick/bounds) would
  // never re-run to send the very first request once `readyRef` flips true.
  const [readyVersion, setReadyVersion] = useState(0)

  useEffect(() => {
    readyRef.current = false
    busyRef.current = false
    setFrame(null)

    const worker = new Worker(
      new URL("../workers/vehicleWorker.ts", import.meta.url),
      { type: "module" }
    )
    workerRef.current = worker

    worker.onmessage = (event: MessageEvent) => {
      const msg = event.data
      if (msg.type === "ready") {
        readyRef.current = true
        setReadyVersion((v) => v + 1)
      } else if (msg.type === "frame") {
        busyRef.current = false
        if (msg.requestId !== latestRequestId.current) return // superseded by a newer request
        frameVersion.current += 1
        setFrame({
          count: msg.count,
          positions: msg.positions,
          colors: msg.colors,
          weights: msg.weights,
          truncated: msg.truncated,
          version: frameVersion.current,
        })
      }
    }

    const buffers = buildSegmentBuffers(
      segments,
      freeSpeedLookup,
      roads,
      laneCounts
    )
    worker.postMessage(
      { type: "init", buffers },
      segmentBufferTransferList(buffers)
    )

    return () => {
      worker.terminate()
      workerRef.current = null
    }
    // Rebuilding is keyed on the dataset only — tick/bounds changes are handled by the
    // second effect below, not by tearing down and recreating the worker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, freeSpeedLookup, roads, laneCounts])

  useEffect(() => {
    const worker = workerRef.current
    if (!worker || !readyRef.current || !bounds || busyRef.current) return
    busyRef.current = true
    const requestId = ++nextRequestId.current
    latestRequestId.current = requestId
    worker.postMessage({ type: "frame", requestId, currentTick, bounds })
  }, [currentTick, bounds, readyVersion])

  return frame
}
