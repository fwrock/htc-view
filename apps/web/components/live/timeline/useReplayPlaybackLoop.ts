import { useEffect, useRef } from "react"
import { useReplayPlaybackStore } from "./replayPlaybackStore"

/** Drives the replay `currentTick` forward via requestAnimationFrame while playing.
 *  `ticksPerSecond` converts the scenario's simulated-time unit into ticks, so
 *  `speedMultiplier` stays expressed in simulated-seconds per real second. Loops back to
 *  `tickMin` at the end of the range (mirrors `htc-replay/web`'s `usePlaybackLoop`). */
export function useReplayPlaybackLoop(ticksPerSecond: number): void {
  const rafRef = useRef<number | null>(null)
  const lastFrameMsRef = useRef<number | null>(null)

  useEffect(() => {
    const tps = ticksPerSecond > 0 ? ticksPerSecond : 1

    const tick = (nowMs: number) => {
      const { isPlaying, speedMultiplier, advanceBy } = useReplayPlaybackStore.getState()
      if (isPlaying) {
        const lastMs = lastFrameMsRef.current
        if (lastMs != null) {
          const deltaRealSeconds = (nowMs - lastMs) / 1000
          advanceBy(deltaRealSeconds * speedMultiplier * tps)
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
