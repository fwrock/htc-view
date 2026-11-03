"use client"

import { useI18n } from "@/components/i18n-provider"

import { useMemo, useRef, useState } from "react"
import MapGL, { AttributionControl, Layer, Marker, NavigationControl, Source, type MapRef } from "react-map-gl/maplibre"
import type { FeatureCollection, Geometry } from "geojson"
import { getMapStyle } from "@/lib/map-config"
import { entityKind, type EditorDocument, type Entity } from "@/lib/scenario-editor"
import "maplibre-gl/dist/maplibre-gl.css"

export function ScenarioNetworkMap({ document, selected, onSelect, onNode, onConnect, onMove }: {
  document: EditorDocument; selected: string | null
  onSelect: (id: string) => void; onNode: (longitude: number, latitude: number) => void
  onConnect: (from: string, to: string, rail: boolean) => void
  onMove: (id: string, longitude: number, latitude: number) => void
}) {
  const { t: translateText } = useI18n()

  const map = useRef<MapRef>(null)
  const [tool, setTool] = useState("select")
  const [start, setStart] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const osm = document.map_mode === "osm"
  const style = useMemo(() => getMapStyle(osm ? "osm" : undefined, osm ? "osm" : "none"), [osm])
  const nodes = useMemo(() => new Map(document.actors.filter((a) => entityKind(a) === "Node").map((a) => [a.id, a])), [document.actors])
  const point = (node: Entity | undefined): [number, number] | null => {
    const s = node?.data.content
    return s && Number.isFinite(s.longitude) && Number.isFinite(s.latitude) && Math.abs(Number(s.longitude)) <= 180 && Math.abs(Number(s.latitude)) <= 85.05112878 ? [Number(s.longitude), Number(s.latitude)] : null
  }
  const features: FeatureCollection<Geometry> = { type: "FeatureCollection", features: [] }
  for (const actor of document.actors) {
    const kind = entityKind(actor), s = actor.data.content
    if (["Link", "RailLink"].includes(kind)) {
      const from = point(nodes.get(String(s.from))), to = point(nodes.get(String(s.to)))
      if (from && to) {
        const coordinates = osm && kind === "Link" ? document.road_network?.links[actor.id]?.coordinates ?? [from, to] : [from, to]
        features.features.push({ type: "Feature", geometry: { type: "LineString", coordinates },
          properties: { id: actor.id, kind, mode: String(s.simulationMode), selected: actor.id === selected } })
        const index = Math.max(0, Math.floor((coordinates.length - 1) / 2)), a = coordinates[index]!, b = coordinates[index + 1]!
        const dx = (b[0] - a[0]) * .15, dy = (b[1] - a[1]) * .15, x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2
        features.features.push({ type: "Feature", geometry: { type: "LineString", coordinates: [[x - dx - dy / 2, y - dy + dx / 2], [x, y], [x - dx + dy / 2, y - dy - dx / 2]] }, properties: { kind: "Direction" } })
      }
    } else if (["Node", "BusStop", "SubwayStation", "BusStation", "TrafficSignal"].includes(kind)) {
      const locations = kind === "TrafficSignal" ? (Array.isArray(s.nodes) ? s.nodes.map(String) : []) : [String(s.nodeId ?? s.origin ?? actor.id)]
      for (const id of locations) {
        const position = point(nodes.get(id))
        if (position) features.features.push({ type: "Feature", geometry: { type: "Point", coordinates: position },
          properties: { id: actor.id, kind, label: String(s.name ?? s.label ?? actor.id), selected: actor.id === selected } })
      }
    }
  }
  const fit = () => {
    const points = [...nodes.values()].map(point).filter((p): p is [number, number] => !!p)
    if (!points.length) return
    const bounds = points.reduce<[number, number, number, number]>((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [180, 90, -180, -90])
    map.current?.fitBounds([[bounds[0]!, bounds[1]!], [bounds[2]!, bounds[3]!]], { padding: 60, maxZoom: 17, duration: 0 })
  }
  const node = selected ? nodes.get(selected) : undefined
  const position = point(node)
  return <div className="flex flex-col gap-2">
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {[["select", "Selecionar"], ["node", "Adicionar nó"], ["road", "Conectar via"], ["rail", "Conectar trilho"], ["move", "Mover nó"]].map(([value, label]) =>
        <button type="button" key={value} disabled={osm && ["node", "road", "move"].includes(value!)} aria-pressed={tool === value}
          className={`rounded-sm border px-2 py-1 disabled:opacity-40 ${tool === value ? "border-primary bg-primary/10" : "border-border"}`}
          onClick={() => { setTool(value!); setStart(null) }}>{translateText(label)}</button>)}
      <button type="button" className="ml-auto underline" onClick={fit}>{translateText("Enquadrar rede")}</button>
    </div>
    <p className="text-[11px] text-muted-foreground">
      {tool === "node" ? translateText("Clique no mapa para criar um nó.") : tool === "move" ? translateText("Selecione um nó e arraste o marcador.") : ["road", "rail"].includes(tool) ? start ? translateText("Origem {0}: clique no nó de destino.", { 0: start }) : translateText("Clique no nó de origem e depois no destino. A ligação é direcional.") : translateText("Clique em uma via, nó, sinal ou parada para editar. Arraste o mapa para navegar.")}
    </p>
    <div className="relative h-[460px] overflow-hidden rounded-sm border border-border" aria-label={translateText("Mapa editável do cenário")}>
      <MapGL ref={map} mapStyle={style} attributionControl={false} initialViewState={{ longitude: 0, latitude: 0, zoom: 2 }}
        interactiveLayerIds={["editor-roads", "editor-nodes", "editor-stops"]} onLoad={fit}
        onError={(event) => setError(event.error.message)} onClick={(event) => {
          const feature = ["road", "rail", "move"].includes(tool) ? event.features?.find((feature) => feature.properties?.kind === "Node") ?? event.features?.[0] : event.features?.[0]
          const id = feature?.properties?.id as string | undefined
          if (tool === "node" && !osm) { onNode(event.lngLat.lng, event.lngLat.lat); return }
          if (id && ["road", "rail"].includes(tool) && feature?.properties?.kind === "Node") {
            if (start && start !== id) { onConnect(start, id, tool === "rail"); setStart(null) }
            else setStart(id)
          }
          if (id) onSelect(id)
        }}>
        <AttributionControl compact={false} position="bottom-left" />
        <NavigationControl position="top-right" />
        <Source id="editor-network" type="geojson" data={features}>
          <Layer id="editor-roads" type="line" filter={["all", ["==", ["geometry-type"], "LineString"], ["!=", ["get", "kind"], "Direction"]]} paint={{
            "line-width": ["case", ["get", "selected"], 7, 4],
            "line-color": ["case", ["get", "selected"], "#facc15", ["==", ["get", "kind"], "RailLink"], "#c084fc", ["==", ["get", "mode"], "MICRO"], "#38bdf8", "#34d399"],
          }} />
          <Layer id="editor-direction" type="line" filter={["==", ["get", "kind"], "Direction"]} paint={{ "line-color": "#ffffff", "line-width": 2 }} />
          <Layer id="editor-nodes" type="circle" filter={["==", ["get", "kind"], "Node"]} paint={{
            "circle-radius": 5, "circle-color": ["case", ["get", "selected"], "#facc15", "#e2e8f0"], "circle-stroke-color": "#334155", "circle-stroke-width": 1,
          }} />
          <Layer id="editor-stops" type="circle" filter={["all", ["==", ["geometry-type"], "Point"], ["!=", ["get", "kind"], "Node"]]} paint={{
            "circle-radius": 9, "circle-color": ["match", ["get", "kind"], "SubwayStation", "#a855f7", "BusStop", "#2563eb", "BusStation", "#f97316", "#ef4444"],
            "circle-stroke-width": 2, "circle-stroke-color": ["case", ["get", "selected"], "#facc15", "#ffffff"],
          }} />
        </Source>
        {tool === "move" && !osm && node && position && <Marker longitude={position[0]} latitude={position[1]} draggable
          onDragEnd={(event) => onMove(node.id, event.lngLat.lng, event.lngLat.lat)}><span className="cursor-grab rounded-full bg-yellow-300 p-2 text-black">↕</span></Marker>}
      </MapGL>
      {error && <p role="alert" className="absolute bottom-8 left-2 max-w-sm rounded-sm bg-card p-2 text-xs">{translateText("Mapa: ")}{translateText(error)}{translateText(". Os formulários e a validação continuam disponíveis.")}</p>}
    </div>
    <p className="text-[11px] text-muted-foreground">{translateText("Azul: MICRO · verde: MESO · roxo: trilhos/metrô · laranja: terminal · vermelho: sinal. ")}{osm ? translateText("Rede vinculada à fonte OSM; topologia protegida.") : translateText("Rede independente.")}</p>
  </div>
}
