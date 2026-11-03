import { useEffect, useRef } from "react"
import { useLivePlaybackStore } from "./livePlaybackStore"

/** Drives the live viewer's playback `currentTick` forward via requestAnimationFrame while
 * playing, mirroring the file-replay `usePlaybackLoop` (htc-replay) but capped at `tickMax`
 * — the live edge — rather than a fixed file `tickMax`.
 *
 * `ticksPerSecond` converts the scenario's simulated-time unit into ticks, so
 * `speedMultiplier` stays expressed in simulated-seconds per real second (1 = real time).
 * The edge (`tickMax`) is read straight from the store on every frame, so it grows live as
 * new WebSocket events are ingested without restarting the loop.
 */
export function useLivePlaybackLoop(ticksPerSecond: number): void {
  const rafRef = useRef<number | null>(null)
  const lastFrameMsRef = useRef<number | null>(null)

  useEffect(() => {
    const tps = ticksPerSecond > 0 ? ticksPerSecond : 1

    const tick = (nowMs: number) => {
      const s = useLivePlaybackStore.getState()
      const latest = s.tickMax

      if (s.followLive) {
        if (s.currentTick !== latest) {
          useLivePlaybackStore.setState({ currentTick: latest })
        }
        lastFrameMsRef.current = null
      } else if (s.isPlaying) {
        const lastMs = lastFrameMsRef.current
        if (lastMs != null) {
          const deltaRealSeconds = (nowMs - lastMs) / 1000
          const next = Math.min(
            s.currentTick + deltaRealSeconds * s.speedMultiplier * tps,
            latest
          )
          if (next !== s.currentTick) {
            useLivePlaybackStore.setState({ currentTick: next })
          }
        }
        lastFrameMsRef.current = nowMs
      } else {
        lastFrameMsRef.current = null
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [ticksPerSecond])
}
