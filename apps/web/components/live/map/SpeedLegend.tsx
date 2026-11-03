"use client"

import { useI18n } from "@/components/i18n-provider"
import {
  SPEED_BUCKET_COLORS,
  SPEED_BUCKET_LABELS,
  type SpeedBucket,
} from "./speedColor"

const ORDER: SpeedBucket[] = ["stopped", "slow", "reduced", "flowing"]

export function SpeedLegend() {
  const { t: translateText } = useI18n()

  return (
    <div
      style={{
        position: "absolute",
        bottom: 60,
        left: 12,
        display: "flex",
        gap: 12,
        flexWrap: "wrap",
        maxWidth: "calc(100% - 24px)",
        padding: "6px 10px",
        background: "rgba(20,20,24,0.78)",
        color: "white",
        borderRadius: 6,
        fontSize: 12,
      }}
    >
      {ORDER.map((bucket) => {
        const [r, g, b] = SPEED_BUCKET_COLORS[bucket]
        return (
          <div
            key={bucket}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: `rgb(${r},${g},${b})`,
              }}
            />
            <span>{translateText(SPEED_BUCKET_LABELS[bucket])}</span>
          </div>
        )
      })}
      <span style={{ opacity: 0.75 }}>{translateText("(relativo à velocidade livre da via)")}</span>
      <span style={{ opacity: 0.75 }}>{translateText("Tamanho em metros · aproxime para ver detalhes")}</span>
    </div>
  )
}
