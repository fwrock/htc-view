import { create } from "zustand"

/** Fixed-range playback clock for the *replay* mode (a finished simulation loaded from
 *  `segments.arrow`). Mirrors the standalone `htc-replay/web` `playbackStore`: unlike the live
 *  clock, the range is known and bounded (`tickMin`..`tickMax` from the manifest), there is no
 *  `followLive`, and playing loops back to `tickMin` once it passes `tickMax`. */
export interface ReplayPlaybackState {
  tickMin: number
  tickMax: number
  currentTick: number
  isPlaying: boolean
  /** Simulated seconds advanced per real second of wall-clock playback. */
  speedMultiplier: number

  setRange: (tickMin: number, tickMax: number) => void
  play: () => void
  pause: () => void
  togglePlay: () => void
  setSpeedMultiplier: (speed: number) => void
  setTick: (tick: number) => void
  advanceBy: (deltaTicks: number) => void
}

export const useReplayPlaybackStore = create<ReplayPlaybackState>((set, get) => ({
  tickMin: 0,
  tickMax: 0,
  currentTick: 0,
  isPlaying: false,
  speedMultiplier: 300,

  setRange: (tickMin, tickMax) => set({ tickMin, tickMax, currentTick: tickMin }),
  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),
  setSpeedMultiplier: (speedMultiplier) => set({ speedMultiplier }),
  setTick: (tick) => set({ currentTick: tick }),
  advanceBy: (deltaTicks) => {
    const { currentTick, tickMax, tickMin } = get()
    const next = currentTick + deltaTicks
    set({ currentTick: next > tickMax ? tickMin : next })
  },
}))
