"use client"

import { useI18n } from "@/components/i18n-provider"

import { useLivePlaybackStore } from "./livePlaybackStore"

const SPEED_OPTIONS = [0.25, 0.5, 1, 2, 5, 10, 30, 60, 150, 300, 900, 3600]

/** Bottom playback bar for the live viewer: play/pause, a scrubber over the captured live
 * window, a speed multiplier (simulated-seconds per real second), and a "Ao vivo" button that
 * re-attaches to the live edge. Styled to match the live viewer's existing overlay language. */
export function LiveTimelineScrubber() {
  const { t: translateText, intlLocale } = useI18n()

  const {
    tickMin,
    tickMax,
    currentTick,
    isPlaying,
    followLive,
    speedMultiplier,
    togglePlay,
    setTick,
    setSpeedMultiplier,
    jumpToLive,
  } = useLivePlaybackStore()

  // A degenerate min===max range is legal but useless; give it one tick of travel so the
  // scrubber is still draggable/selectable while waiting for the first live event.
  const max = Math.max(tickMax, tickMin + 1)
  const clamped = Math.min(currentTick, max)

  return (
    <div
      style={{
        position: "absolute",
        left: 12,
        right: 12,
        bottom: 12,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 12px",
        background: "rgba(20, 20, 24, 0.78)",
        color: "white",
        borderRadius: 8,
        fontSize: 13,
      }}
    >
      <button
        onClick={togglePlay}
        disabled={tickMax <= 0}
        style={{
          minWidth: 64,
          padding: "4px 8px",
          borderRadius: 4,
          background: "rgba(255,255,255,0.12)",
          border: "1px solid rgba(255,255,255,0.2)",
          color: "white",
          cursor: tickMax <= 0 ? "not-allowed" : "pointer",
          opacity: tickMax <= 0 ? 0.5 : 1,
        }}
      >
        {isPlaying ? translateText("Pausar") : translateText("Tocar")}
      </button>

      <input
        type="range"
        min={tickMin}
        max={max}
        value={clamped}
        disabled={tickMax <= 0}
        onChange={(e) => setTick(Number(e.target.value))}
        style={{ flex: 1, accentColor: "#2ecc71" }}
      />

      <span style={{ minWidth: 150, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{translateText("tick ")}{Math.round(clamped).toLocaleString(intlLocale)} / {Math.round(tickMax).toLocaleString(intlLocale)}
      </span>

      <select
        value={speedMultiplier}
        onChange={(e) => setSpeedMultiplier(Number(e.target.value))}
        style={{
          padding: "4px 6px",
          borderRadius: 4,
          background: "rgba(0,0,0,0.35)",
          color: "white",
          border: "1px solid rgba(255,255,255,0.2)",
        }}
      >
        {SPEED_OPTIONS.map((s) => (
          <option key={s} value={s} style={{ color: "black" }}>
            {s}{translateText("x")}</option>
        ))}
      </select>

      <button
        onClick={jumpToLive}
        disabled={tickMax <= 0}
        style={{
          minWidth: 64,
          padding: "4px 8px",
          borderRadius: 4,
          background: followLive ? "rgba(46, 204, 113, 0.85)" : "rgba(255,255,255,0.12)",
          border: "1px solid rgba(255,255,255,0.2)",
          color: followLive ? "white" : "white",
          cursor: tickMax <= 0 ? "not-allowed" : "pointer",
          opacity: tickMax <= 0 ? 0.5 : 1,
        }}
      >
        {followLive ? translateText("Ao vivo ●") : translateText("Ao vivo")}
      </button>
    </div>
  )
}
