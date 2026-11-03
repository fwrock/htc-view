"use client"

import { useI18n } from "@/components/i18n-provider"

import { useEffect, useMemo, useRef, useState } from "react"
import MapGL, {
  Layer,
  NavigationControl,
  Source,
  type MapRef,
} from "react-map-gl/maplibre"
import type { Feature, Polygon } from "geojson"
import { Button } from "@workspace/ui/components/button"
import { getMapStyle } from "@/lib/map-config"
import type { ImportOptions, ImportReport } from "@/lib/osm-import-api"
import "maplibre-gl/dist/maplibre-gl.css"

export default function OsmImportMap({
  report,
  bbox,
  onArea,
  disabled,
}: {
  report: ImportReport | null
  bbox: ImportOptions["bbox"]
  onArea: (box: NonNullable<ImportOptions["bbox"]>) => void
  disabled: boolean
}) {
  const { t: translateText } = useI18n()

  const map = useRef<MapRef>(null)
  const [selectedId, setSelectedId] = useState<string | number | null>(null)
  const selected = report?.geometry_preview?.features.find(
    (feature) => feature.id === selectedId
  )?.properties
  const [mapError, setMapError] = useState(false)
  const style = useMemo(() => getMapStyle("osm"), [])
  const extent = report?.selection?.extent
  useEffect(() => {
    if (extent)
      map.current?.fitBounds(
        [
          [extent.west, extent.south],
          [extent.east, extent.north],
        ],
        { padding: 45, duration: 400 }
      )
  }, [extent])
  const area: Feature<Polygon> | null = bbox
    ? {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [bbox[0], bbox[1]],
              [bbox[2], bbox[1]],
              [bbox[2], bbox[3]],
              [bbox[0], bbox[3]],
              [bbox[0], bbox[1]],
            ],
          ],
        },
      }
    : null

  return (
    <section className="flex flex-col gap-2" aria-label={translateText("Mapa de prévia OSM")}>
      <div className="h-[420px] overflow-hidden rounded-sm border border-border">
        <MapGL
          ref={map}
          initialViewState={{ longitude: -46.6333, latitude: -23.55, zoom: 10 }}
          mapStyle={style}
          renderWorldCopies={false}
          style={{ width: "100%", height: "100%" }}
          interactiveLayerIds={["import-roads"]}
          onError={() => setMapError(true)}
          onLoad={() => {
            if (extent)
              map.current?.fitBounds(
                [
                  [extent.west, extent.south],
                  [extent.east, extent.north],
                ],
                { padding: 45 }
              )
          }}
          onClick={(event) => setSelectedId(event.features?.[0]?.id ?? null)}
        >
          <NavigationControl />
          {area && (
            <Source id="import-area" type="geojson" data={area}>
              <Layer
                id="import-area-fill"
                type="fill"
                paint={{ "fill-color": "#f59e0b", "fill-opacity": 0.08 }}
              />
              <Layer
                id="import-area-line"
                type="line"
                paint={{
                  "line-color": "#f59e0b",
                  "line-width": 2,
                  "line-dasharray": [3, 2],
                }}
              />
            </Source>
          )}
          <Source
            id="import-roads-source"
            type="geojson"
            data={
              report?.geometry_preview ?? {
                type: "FeatureCollection",
                features: [],
              }
            }
          >
            <Layer
              id="import-roads"
              type="line"
              paint={{ "line-color": "#38bdf8", "line-width": 4 }}
            />
          </Source>
        </MapGL>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => {
            const bounds = map.current?.getBounds()
            if (bounds)
              onArea([
                Math.max(-180, bounds.getWest()),
                Math.max(-85.05112878, bounds.getSouth()),
                Math.min(180, bounds.getEast()),
                Math.min(85.05112878, bounds.getNorth()),
              ])
          }}
        >{translateText("Usar área visível")}</Button>
        <p className="text-xs text-muted-foreground">{translateText("Azul: links da prévia. Âmbar: área solicitada. As vias são preservadas inteiras.")}</p>
      </div>
      {mapError && (
        <p role="status" className="text-xs text-muted-foreground">{translateText("Uma camada do mapa não carregou. A seleção por coordenadas e o relatório continuam disponíveis.")}</p>
      )}
      <p className="text-xs text-muted-foreground">{translateText("Dados de vias:")}{" "}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >{translateText("© OpenStreetMap contributors")}</a>
        .
      </p>
      {selected && (
        <p className="text-xs" aria-live="polite">
          <strong>{translateText(selected.name || "Via sem nome")}</strong>{translateText(" · OSM way")}{" "}
          <a
            href={`https://www.openstreetmap.org/way/${encodeURIComponent(selected.osm_way_id)}`}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline"
          >
            {translateText(selected.osm_way_id)}
          </a>
          {" · "}
          {translateText(selected.direction)} · {translateText(Number(selected.length_m).toFixed(1))}{translateText(" m ·")}{" "}
          {translateText(selected.speed_limit_kmh)}{translateText(" km/h")}</p>
      )}
    </section>
  )
}
