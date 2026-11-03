"use client"

import { useI18n } from "@/components/i18n-provider"

import { useReplayPlaybackStore } from "./replayPlaybackStore"

const SPEED_OPTIONS = [30, 60, 150, 300, 900, 3600]

/** Bottom playback bar for replay mode: play/pause, a scrubber over the fixed
 *  `[tickMin, tickMax]` range, and a speed multiplier. Mirrors `htc-replay/web`'s
 *  `TimelineScrubber`, styled to match the live viewer's overlay language. */
export function ReplayTimelineScrubber() {
  const { t: translateText, intlLocale } = useI18n()

  const { tickMin, tickMax, currentTick, isPlaying, speedMultiplier, togglePlay, setTick, setSpeedMultiplier } =
    useReplayPlaybackStore()

  const max = Math.max(tickMax, tickMin + 1)
  const clamped = Math.min(Math.max(currentTick, tickMin), max)

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
    </div>
  )
}
