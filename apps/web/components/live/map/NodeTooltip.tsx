"use client"

import { useI18n } from "@/components/i18n-provider"
import type { NodeInfo } from "./layers/nodeLayer";

interface Props {
  x: number;
  y: number;
  node: NodeInfo;
}

export function NodeTooltip({ x, y, node }: Props) {
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
        zIndex: 10
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 2 }}>{node.nodeId}</div>
      <div>{node.hasSignal ? translateText("com semáforo") : translateText("interseção")}</div>
      <div style={{ opacity: 0.7, marginTop: 2 }}>{translateText("clique para fixar detalhes")}</div>
    </div>
  );
}
