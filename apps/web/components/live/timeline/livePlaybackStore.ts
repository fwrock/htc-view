import { create } from "zustand"

/** Playback clock for the live viewer, decoupled from the raw arrival rate of the WebSocket
 * feed. The live `LiveSegmentStore` keeps appending segments as events arrive (`latestTick`
 * grows monotonically); this store drives a separate *visualization* tick that a human can
 * pause, scrub, slow down or fast-forward — so a small scenario that executes in a couple of
 * wall-clock seconds can be watched back at a comfortable, controllable pace.
 *
 * Two modes:
 *  - `followLive` (default): `currentTick` tracks the live edge (`tickMax`) as it arrives.
 *  - controlled: the moment the human pauses/scrubs, `followLive` flips off and `currentTick`
 *    advances at `speedMultiplier` simulated-seconds per real second, never past `tickMax`
 *    (you can catch up to the edge but not run ahead of data that hasn't arrived yet).
 */
export interface LivePlaybackState {
  tickMin: number
  tickMax: number
  currentTick: number
  isPlaying: boolean
  /** Simulated seconds advanced per real second of wall-clock playback (1 = real time). */
  speedMultiplier: number
  /** When true, `currentTick` follows `tickMax` (the live edge) instead of advancing on its own. */
  followLive: boolean

  setTickMax: (tickMax: number) => void
  /** User-initiated scrub: clamps to the known range and hands control to the human. */
  setTick: (tick: number) => void
  play: () => void
  pause: () => void
  togglePlay: () => void
  setSpeedMultiplier: (speed: number) => void
  /** Re-attach to the live edge (and keep following it). */
  jumpToLive: () => void
  reset: () => void
}

export const useLivePlaybackStore = create<LivePlaybackState>((set) => ({
  tickMin: 0,
  tickMax: 0,
  currentTick: 0,
  isPlaying: true,
  speedMultiplier: 1,
  followLive: true,

  setTickMax: (tickMax) =>
    set((s) => ({
      tickMax,
      currentTick: Math.min(s.currentTick, tickMax),
    })),

  setTick: (tick) =>
    set((s) => ({
      currentTick: Math.min(Math.max(tick, s.tickMin), s.tickMax),
      followLive: false,
      isPlaying: false,
    })),

  play: () => set({ isPlaying: true, followLive: false }),
  pause: () => set({ isPlaying: false, followLive: false }),
  togglePlay: () =>
    set((s) =>
      s.isPlaying
        ? { isPlaying: false, followLive: false }
        : { isPlaying: true, followLive: false }
    ),
  setSpeedMultiplier: (speedMultiplier) => set({ speedMultiplier }),
  jumpToLive: () => set((s) => ({ currentTick: s.tickMax, followLive: true, isPlaying: true })),
  reset: () => set({ tickMin: 0, tickMax: 0, currentTick: 0, isPlaying: true, followLive: true }),
}))
