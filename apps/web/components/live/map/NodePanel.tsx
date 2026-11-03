"use client"

import { useI18n } from "@/components/i18n-provider"
import type { NodeInfo } from "./layers/nodeLayer";
import type { TrafficSignalConfig } from "../types/replay";
import { computeSignalPhases } from "./trafficSignal";

interface Props {
  node: NodeInfo;
  signal: TrafficSignalConfig | null;
  currentTick: number;
  onClose: () => void;
}

export function NodePanel({ node, signal, currentTick, onClose }: Props) {
  const { t: translateText } = useI18n()

  const phases = signal ? computeSignalPhases(signal, currentTick) : null;

  return (
    <div
      style={{
        position: "absolute",
        top: 56,
        right: 0,
        bottom: 0,
        width: 280,
        background: "rgba(20,20,24,0.92)",
        color: "white",
        padding: 16,
        fontSize: 13,
        boxShadow: "-2px 0 8px rgba(0,0,0,0.3)",
        overflowY: "auto"
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <strong>{translateText("Detalhes do nó")}</strong>
        <button onClick={onClose} style={{ cursor: "pointer" }}>
          ✕
        </button>
      </div>
      <Field label={translateText("ID")} value={node.nodeId} />
      <Field label={translateText("Posição (lon, lat)")} value={`${node.position[0].toFixed(5)}, ${node.position[1].toFixed(5)}`} />
      {!node.hasSignal && <Field label={translateText("Semáforo")} value="não" />}

      {signal && phases && (
        <>
          <div style={{ marginTop: 16, marginBottom: 8, opacity: 0.65, fontSize: 11 }}>{translateText("SEMÁFORO — ")}{translateText(signal.signalId)}
          </div>
          <Field label={translateText("Duração do ciclo")} value={`${signal.cycleDuration} ticks`} />
          <div style={{ marginTop: 8 }}>
            {phases.map((p) => (
              <div
                key={p.origin}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "6px 8px",
                  marginBottom: 6,
                  borderRadius: 4,
                  background: "rgba(255,255,255,0.06)"
                }}
              >
                <div>
                  <div style={{ fontSize: 11, opacity: 0.7 }}>{translateText("via")}</div>
                  <div>{translateText(p.origin)}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div
                    style={{
                      fontWeight: 700,
                      color: p.state === "Green" ? "#38b054" : "#dc2828"
                    }}
                  >
                    {p.state === "Green" ? translateText("VERDE") : translateText("VERMELHO")}
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.7 }}>{p.remainingTicks}{translateText(" ticks restantes")}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {node.hasSignal && !signal && (
        <div style={{ marginTop: 12, opacity: 0.7 }}>{translateText("Este nó tem semáforo, mas a configuração de fases não foi encontrada.")}</div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  const { t: translateText } = useI18n()

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ opacity: 0.65, fontSize: 11 }}>{translateText(label)}</div>
      <div>{translateText(value)}</div>
    </div>
  );
}
