"use client"

import { useI18n } from "@/components/i18n-provider"
import type { LinkSegment } from "./layers/linkLayer"

interface Props {
  x: number
  y: number
  link: LinkSegment
}

export function LinkTooltip({ x, y, link }: Props) {
  const { t: translateText } = useI18n()

  return (
    <div
      style={{
        position: "absolute",
        left: x + 12,
        top: y + 12,
        pointerEvents: "none",
        background: "rgba(20,20,24,0.9)",
        color: "white",
        padding: "6px 10px",
        borderRadius: 6,
        fontSize: 12,
        whiteSpace: "nowrap",
        zIndex: 10,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 2 }}>
        {translateText(link.osm?.name || link.linkId)}
      </div>
      {link.osm && (
        <div>{translateText("HTC ")}{link.linkId}{translateText(" · OSM way ")}{link.osm.osmWayId} · {translateText(link.osm.direction)}
        </div>
      )}
      <div>
        {translateText(link.simulationMode)} · {link.lengthM.toFixed(0)}{translateText("m · ")}{link.lanes}{" "}{translateText("faixa(s) · limite ")}{link.freeSpeedKmh.toFixed(0)}{translateText(" km/h")}</div>
      <div>Cluster node: {link.hostNode || "Unknown"}</div>
      <div style={{ opacity: 0.7, marginTop: 2 }}>{translateText("clique para fixar detalhes")}</div>
    </div>
  )
}
