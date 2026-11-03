"use client"

import { useI18n } from "@/components/i18n-provider"
import type { LinkSegment } from "./layers/linkLayer"

interface Props {
  link: LinkSegment
  onClose: () => void
  relatedLinks?: LinkSegment[]
  onSelectLink?: (link: LinkSegment) => void
}

export function LinkPanel({
  link,
  onClose,
  relatedLinks,
  onSelectLink,
}: Props) {
  const { t: translateText } = useI18n()

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
        overflowY: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <strong>{translateText("Detalhes do link")}</strong>
        <button onClick={onClose} style={{ cursor: "pointer" }}>
          ✕
        </button>
      </div>
      {link.osm && (
        <>
          <Field label={translateText("Rua OSM")} value={link.osm.name || "Sem nome"} />
          <div style={{ marginBottom: 10 }}>
            <a
              href={`https://www.openstreetmap.org/way/${encodeURIComponent(link.osm.osmWayId)}`}
              target="_blank"
              rel="noreferrer"
            >{translateText("OSM way ")}{link.osm.osmWayId} ↗
            </a>
          </div>
          <Field
            label={translateText("Direção do segmento")}
            value={
              link.osm.direction === "forward"
                ? "Sentido da via OSM"
                : "Sentido inverso da via OSM"
            }
          />
          {!!relatedLinks?.length && (
            <label style={{ display: "block", marginBottom: 12 }}>{translateText("Links HTC desta via")}<select
                aria-label={translateText("Links HTC da via OSM")}
                value={link.linkId}
                onChange={(event) => {
                  const chosen = relatedLinks.find(
                    (item) => item.linkId === event.target.value
                  )
                  if (chosen) onSelectLink?.(chosen)
                }}
                style={{
                  display: "block",
                  width: "100%",
                  background: "#202028",
                  marginTop: 6,
                }}
              >
                {relatedLinks.map((item) => (
                  <option key={item.linkId} value={item.linkId}>
                    {item.linkId} · {translateText(item.osm?.direction)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <details style={{ marginBottom: 12 }}>
            <summary>{translateText("Propriedades da fonte OSM")}</summary>
            {Object.entries(link.osm.tags).map(([key, value]) => (
              <Field key={key} label={translateText(key)} value={value} />
            ))}
          </details>
        </>
      )}
      <Field label={translateText("ID")} value={link.linkId} />
      <Field label={translateText("Modo de simulação")} value={link.simulationMode} />
      <Field label={translateText("Comprimento")} value={`${link.lengthM.toFixed(1)} m`} />
      <Field label={translateText("Faixas")} value={String(link.lanes)} />
      <Field
        label={translateText("Velocidade livre (freeSpeed)")}
        value={`${link.freeSpeedKmh.toFixed(1)} km/h`}
      />
      <Field
        label={translateText("Nó de origem (lon, lat)")}
        value={`${link.sourcePosition[0].toFixed(5)}, ${link.sourcePosition[1].toFixed(5)}`}
      />
      <Field
        label={translateText("Nó de destino (lon, lat)")}
        value={`${link.targetPosition[0].toFixed(5)}, ${link.targetPosition[1].toFixed(5)}`}
      />
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  const { t: translateText } = useI18n()

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ opacity: 0.65, fontSize: 11 }}>{translateText(label)}</div>
      <div>{translateText(value)}</div>
    </div>
  )
}
