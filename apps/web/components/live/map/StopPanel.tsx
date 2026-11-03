"use client"

import { useI18n } from "@/components/i18n-provider"
import type { StopConfig } from "../types/replay"
import type { StopTransitStatus } from "../live/liveTransitStore"
import type { LiveConnectionState } from "../types/live"

export function StopPanel({ stop, status, connection, currentTick, onClose }: {
  stop: StopConfig; status?: StopTransitStatus; connection?: LiveConnectionState;
  currentTick: number; onClose: () => void
}) {
  const { t, intlLocale } = useI18n()
  const kind = {
    BusStop: "Parada de ônibus",
    BusStation: "Terminal de ônibus",
    SubwayStation: "Estação de metrô",
  }[stop.kind]
  const coordinate = (value: number) => value.toLocaleString(intlLocale, {
    minimumFractionDigits: 5,
    maximumFractionDigits: 5,
  })
  const number = (value?: number) => value === undefined ? t("Não informado") : value.toLocaleString(intlLocale, { maximumFractionDigits: 1 })

  return (
    <section
      aria-label={t("Detalhes da parada ou estação")}
      style={{
        position: "absolute", top: 56, right: 0, bottom: 0,
        width: 280, maxWidth: "100%", background: "rgba(20,20,24,0.92)",
        color: "white", padding: 16, fontSize: 13,
        boxShadow: "-2px 0 8px rgba(0,0,0,0.3)", overflowY: "auto",
        overflowWrap: "anywhere",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <strong>{t(kind)}</strong>
        <button type="button" aria-label={t("Fechar")} onClick={onClose} style={{ cursor: "pointer" }}>✕</button>
      </div>
      <dl>
        {[
          [t("Nome"), stop.label.trim() || t("Não informado")],
          [t("ID"), stop.stopId],
          [t("Tipo"), t(kind)],
          [t("Longitude"), coordinate(stop.lon)],
          [t("Latitude"), coordinate(stop.lat)],
        ].map(([label, value]) => (
          <div key={label} style={{ marginBottom: 12 }}>
            <dt style={{ opacity: 0.65, fontSize: 11 }}>{label}</dt>
            <dd style={{ margin: 0 }}>{value}</dd>
          </div>
        ))}
      </dl>
      <h3 style={{ marginTop: 20, marginBottom: 8, fontWeight: 600 }}>{t("Passageiros e linhas")}</h3>
      {connection && connection !== "open" && <p role="status">{t("Conexão interrompida; dados podem estar desatualizados.")}</p>}
      {!status ? <p style={{ opacity: 0.7 }}>{t("Sem relatos de passageiros para este local no instante selecionado.")}</p> : <>
        <p style={{ fontSize: 11, opacity: 0.7 }}>{t("Valores observados no stream; linhas sem relatos não aparecem. Ocupação refere-se ao último veículo observado, não à linha inteira.")}</p>
        <p style={{ fontSize: 11, opacity: 0.7 }}>{t("Janela de eventos (ticks)")}: {number(status.windowStart)}–{number(currentTick)}</p>
        {status.lines.map((line) => <section key={line.line} style={{ marginTop: 12, padding: 10, border: "1px solid #475569", borderRadius: 4 }}>
          <strong>{t("Linha")}: {line.line}</strong>
          <dl style={{ marginTop: 8 }}>
            {[
              [t("Passageiros esperando"), number(line.waiting)],
              [t("Chegadas observadas na janela"), number(line.arrivals)],
              [t("Embarques observados na janela"), number(line.boarded)],
              [t("Último relato da parada (tick)"), number(line.tick)],
              [t("Último veículo observado"), line.vehicle ? `${line.vehicle.kind} · ${line.vehicle.id}` : line.vehicleId ?? t("Não informado")],
              [t("Passageiros a bordo"), number(line.vehicle?.passengers)],
              [t("Capacidade"), number(line.vehicle?.capacity)],
              [t("Ocupação do veículo"), line.vehicle?.occupancy === undefined ? t("Não informado") : `${number(line.vehicle.occupancy)}%`],
              [t("Último relato do veículo (tick)"), number(line.vehicle?.tick)],
            ].map(([label, value]) => <div key={label} style={{ marginBottom: 8 }}>
              <dt style={{ opacity: 0.65, fontSize: 11 }}>{label}</dt><dd style={{ margin: 0 }}>{value}</dd>
            </div>)}
          </dl>
        </section>)}
      </>}
    </section>
  )
}
