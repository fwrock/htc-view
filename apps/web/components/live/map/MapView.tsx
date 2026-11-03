"use client"

import { useI18n } from "@/components/i18n-provider"
import { useEffect, useMemo, useState } from "react"
import { DeckGL } from "@deck.gl/react"
import { WebMercatorViewport, type PickingInfo } from "@deck.gl/core"
import MapGL, { AttributionControl } from "react-map-gl/maplibre"
import { getMapStyle } from "@/lib/map-config"
import { roadLookup } from "./roadGeometry"
import { SidewalkNetwork, prepareWalkingScene } from "./sidewalks"
import { buildSidewalks, createSidewalkLayer } from "./layers/sidewalkLayer"
import "maplibre-gl/dist/maplibre-gl.css"
import type {
  LinksTable,
  NodesTable,
  RailLinksTable,
  SegmentsTable,
  BoundingBox,
  StopConfig,
  TrafficSignalConfig,
} from "../types/replay"
import {
  buildPositionBuffers,
  createLinkLayerBinary,
  linkSegmentAt,
  type LinkSegment,
} from "./layers/linkLayer"
import {
  buildNodePositionBuffer,
  createNodeLayerBinary,
  nodeInfoAt,
  type NodeInfo,
} from "./layers/nodeLayer"
import {
  buildSignalMarkers,
  createSignalSpriteLayer,
  type SignalMarker,
} from "./layers/signalSpriteLayer"
import { createStopSpriteLayer } from "./layers/stopSpriteLayer"
import { createRailLinkLayers } from "./layers/railLinkLayer"
import { buildLaneMarks, createLaneLayer, snapWindow } from "./layers/laneLayer"
import { computeVehiclePositions } from "./layers/vehicleScatterLayer"
import { createVehicleSpriteLayer } from "./layers/vehicleSpriteLayer"
import { createVehicleIconLayer } from "./layers/vehicleIconLayer"
import {
  createVehicleBinaryHeatmapLayer,
  createVehicleBinaryScatterLayer,
} from "./layers/vehicleBinaryLayer"
import {
  createEmissionHeatmapLayer,
  type EmissionKind,
} from "./layers/emissionHeatmapLayer"
import { shouldAggregate } from "./lod"
import { LinkTooltip } from "./LinkTooltip"
import { LinkPanel } from "./LinkPanel"
import { NodeTooltip } from "./NodeTooltip"
import { NodePanel } from "./NodePanel"
import { StopPanel } from "./StopPanel"
import type { LiveTransitStore } from "../live/liveTransitStore"
import type { LiveConnectionState } from "../types/live"
import { useVehicleWorker } from "../data/useVehicleWorker"
import type { Bounds } from "../workers/spatialGrid"

export type VehicleRepresentation = "circle" | "sprite" | "shape"

interface Props {
  links: LinksTable
  nodes: NodesTable
  signals: TrafficSignalConfig[]
  stops: StopConfig[]
  railLinks: RailLinksTable
  segments: SegmentsTable
  transit?: LiveTransitStore
  transitConnection?: LiveConnectionState
  boundingBox: BoundingBox | null
  currentTick: number
  hasEmissions: boolean
  emissionKind: EmissionKind
  representation: VehicleRepresentation
  freeSpeedLookup: Map<string, number>
  onReady?: () => void
}

interface ViewState {
  longitude: number
  latitude: number
  zoom: number
  pitch?: number
  bearing?: number
}

type Hover =
  | { x: number; y: number; kind: "link"; link: LinkSegment }
  | { x: number; y: number; kind: "node"; node: NodeInfo }
type Selected =
  | { kind: "link"; link: LinkSegment }
  | { kind: "node"; node: NodeInfo }
  | { kind: "stop"; stop: StopConfig }

function useWindowSize() {
  const [size, setSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  })
  useEffect(() => {
    const onResize = () =>
      setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])
  return size
}

export function MapView({
  links,
  nodes,
  signals,
  stops,
  railLinks,
  segments,
  transit,
  transitConnection,
  boundingBox,
  currentTick,
  hasEmissions,
  emissionKind,
  representation,
  freeSpeedLookup,
  onReady,
}: Props) {
  const { t: translateText, intlLocale } = useI18n()

  const [hover, setHover] = useState<Hover | null>(null)
  const [selected, setSelected] = useState<Selected | null>(null)
  const [background, setBackground] = useState<"auto" | "osm" | "none">(() => {
    const value = new URLSearchParams(window.location.search).get("background")
    return value === "osm" || value === "none" ? value : "auto"
  })
  const sidewalkNetwork = useMemo(() => new SidewalkNetwork(links), [links])
  const walkingScene = useMemo(
    () => prepareWalkingScene(segments, sidewalkNetwork),
    [segments, sidewalkNetwork]
  )
  const displaySegments = walkingScene.segments
  const roads = useMemo(
    () => new Map([...roadLookup(links), ...walkingScene.paths]),
    [links, walkingScene.paths]
  )
  const selectedWayId =
    selected?.kind === "link" ? selected.link.osm?.osmWayId : undefined
  const relatedLinks = useMemo(
    () =>
      selectedWayId
        ? links.linkId.flatMap((id, index) =>
            links.roadNetwork?.links[id]?.osmWayId === selectedWayId
              ? [linkSegmentAt(links, index)]
              : []
          )
        : [],
    [links, selectedWayId]
  )
  const mapStyle = useMemo(
    () => getMapStyle(links.roadNetwork ? "osm" : undefined, background === "auto" ? undefined : background),
    [links.roadNetwork, background]
  )

  const windowSize = useWindowSize()
  const initialViewState = useMemo(() => {
    if (!boundingBox) return { longitude: 0, latitude: 0, zoom: 2 }
    return new WebMercatorViewport({ width: windowSize.width, height: windowSize.height }).fitBounds(
      [[boundingBox.minLon, boundingBox.minLat], [boundingBox.maxLon, boundingBox.maxLat]],
      { padding: 40, maxZoom: 18 }
    )
  }, [boundingBox, windowSize])

  const [viewState, setViewState] = useState<ViewState>(initialViewState)

  // A generous margin around the visible viewport so vehicles just outside the screen edge
  // don't visibly pop in/out as they cross it — the spatial-grid query cost scales with this
  // area, so it's a deliberate small overscan, not "load everything".
  const bounds: Bounds | null = useMemo(() => {
    if (windowSize.width === 0 || windowSize.height === 0) return null
    const viewport = new WebMercatorViewport({
      ...viewState,
      width: windowSize.width,
      height: windowSize.height,
    })
    const [west, south, east, north] = viewport.getBounds()
    const marginLon = (east - west) * 0.25
    const marginLat = (north - south) * 0.25
    return {
      west: west - marginLon,
      south: south - marginLat,
      east: east + marginLon,
      north: north + marginLat,
    }
  }, [viewState, windowSize])

  const laneCounts = useMemo(
    () => new Map(links.linkId.map((id, i) => [id, links.lanes[i]!])),
    [links]
  )
  const aggregate = shouldAggregate(viewState.zoom)

  // Binary + worker path — used for "circle" (the scale-oriented representation) and the
  // congestion heatmap. SVG/shape stay on the plain JS-object path (computeVehiclePositions)
  // below: at the vehicle counts where those are actually legible on screen, that path is
  // simple and fast enough, and rendering millions of overlapping icons isn't visually
  // meaningful anyway — see docs/KNOWN_GAPS.md.
  const useBinaryPath =
    representation === "circle" || (aggregate && !hasEmissions)
  const workerFrame = useVehicleWorker(
    displaySegments,
    freeSpeedLookup,
    currentTick,
    useBinaryPath ? bounds : null,
    roads,
    laneCounts
  )

  // Positions never change after `links`/`nodes` load — only recomputed when the scenario
  // changes, not per frame, not per selection. This (plus the binary layers below) is what
  // took a 718k-link scenario from a ~38s unresponsive stall to sub-second: the old path built
  // a JS object per link/node and made deck.gl call accessor functions that many times to
  // populate its own attribute buffers, every time a layer was reconstructed.
  const linkPositions = useMemo(() => buildPositionBuffers(links), [links])
  const linkLayer = useMemo(
    () =>
      createLinkLayerBinary(
        links,
        linkPositions,
        selected?.kind === "link" ? selected.link.linkId : null
      ),
    [links, linkPositions, selected]
  )

  const nodePositions = useMemo(() => buildNodePositionBuffer(nodes), [nodes])
  const nodeLayer = useMemo(
    () =>
      createNodeLayerBinary(
        nodes,
        nodePositions,
        selected?.kind === "node" ? selected.node.nodeId : null
      ),
    [nodes, nodePositions, selected]
  )
  const signalMarkers = useMemo(
    () => buildSignalMarkers(nodes, links, signals),
    [nodes, links, signals]
  )
  const signalSpriteLayer = useMemo(
    () => createSignalSpriteLayer(signalMarkers, currentTick),
    [signalMarkers, currentTick]
  )
  const stopSpriteLayer = useMemo(() => createStopSpriteLayer(stops), [stops])
  // Lane markings and rail sleepers are centimetres wide: build them only when zoomed in,
  // and only for the tiles around the camera (rebuilt when the camera crosses a tile edge).
  const detailZoom = viewState.zoom >= 16.5
  const detail = useMemo(
    () =>
      detailZoom
        ? snapWindow(viewState.longitude, viewState.latitude, viewState.zoom)
        : null,
    [detailZoom, viewState.longitude, viewState.latitude, viewState.zoom]
  )
  const detailKey = detail?.key ?? null
  const sidewalkLayer = useMemo(
    () =>
      detail
        ? createSidewalkLayer(
            buildSidewalks(
              links,
              detail.window,
              walkingScene.fallbackPaths,
              walkingScene.connectors
            )
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [links, detailKey, walkingScene.fallbackPaths, walkingScene.connectors]
  )
  const laneLayer = useMemo(
    () =>
      detail ? createLaneLayer(buildLaneMarks(links, detail.window)) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [links, detailKey]
  )
  const railLinkLayers = useMemo(
    () => createRailLinkLayers(railLinks, detail?.window ?? null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [railLinks, detailKey]
  )

  // A signal can list more than one node (rare — most control a single intersection), so this
  // is a node_id -> config lookup, not the other way around.
  const signalByNodeId = useMemo(() => {
    const map = new Map<string, TrafficSignalConfig>()
    for (const signal of signals) {
      for (const nodeId of signal.nodeIds) map.set(nodeId, signal)
    }
    return map
  }, [signals])

  const vehiclePositions = useMemo(
    () =>
      useBinaryPath
        ? []
        : computeVehiclePositions(
            displaySegments,
            currentTick,
            freeSpeedLookup,
            roads,
            laneCounts
          ),
    [
      displaySegments,
      currentTick,
      freeSpeedLookup,
      useBinaryPath,
      roads,
      laneCounts,
    ]
  )

  const vehicleLayers = aggregate
    ? hasEmissions
      ? [createEmissionHeatmapLayer(vehiclePositions, emissionKind)]
      : workerFrame
        ? [createVehicleBinaryHeatmapLayer(workerFrame)]
        : []
    : representation === "circle"
      ? workerFrame
        ? [createVehicleBinaryScatterLayer(workerFrame)]
        : []
      : representation === "sprite"
        ? [createVehicleSpriteLayer(vehiclePositions)]
        : [createVehicleIconLayer(vehiclePositions)]

  const layers = [
    linkLayer,
    ...(sidewalkLayer ? [sidewalkLayer] : []),
    ...(laneLayer ? [laneLayer] : []),
    ...railLinkLayers,
    nodeLayer,
    ...vehicleLayers,
    stopSpriteLayer,
    signalSpriteLayer,
  ]

  // Binary-data layers don't carry a per-item JS object for deck.gl to hand back on pick —
  // only `info.index`, resolved into a plain info object on demand here (hover/click are rare,
  // user-driven events; materializing one object per pick is fine, unlike per frame). Nodes
  // are checked first since they render on top of links at the same intersection point.
  const handleHover = (info: PickingInfo) => {
    if (info.layer?.id === "signals-svg" && info.object) {
      const marker = info.object as SignalMarker
      setHover({
        x: info.x,
        y: info.y,
        kind: "node",
        node: nodeInfoAt(nodes, marker.nodeIndex),
      })
    } else if (info.layer?.id === "nodes" && info.index >= 0) {
      setHover({
        x: info.x,
        y: info.y,
        kind: "node",
        node: nodeInfoAt(nodes, info.index),
      })
    } else if (info.layer?.id === "links" && info.index >= 0) {
      setHover({
        x: info.x,
        y: info.y,
        kind: "link",
        link: linkSegmentAt(links, info.index),
      })
    } else {
      setHover(null)
    }
  }

  const handleClick = (info: PickingInfo) => {
    if (info.layer?.id === "stops-svg" && info.object) {
      setSelected({ kind: "stop", stop: info.object as StopConfig })
    } else if (info.layer?.id === "signals-svg" && info.object) {
      setSelected({
        kind: "node",
        node: nodeInfoAt(nodes, (info.object as SignalMarker).nodeIndex),
      })
    } else if (info.layer?.id === "nodes" && info.index >= 0) {
      setSelected({ kind: "node", node: nodeInfoAt(nodes, info.index) })
    } else if (info.layer?.id === "links" && info.index >= 0) {
      setSelected({ kind: "link", link: linkSegmentAt(links, info.index) })
    }
  }

  const focusVehicles = () => {
    let closest: [number, number] | undefined
    let distance = Infinity
    const consider = (point: [number, number]) => {
      const d =
        (point[0] - viewState.longitude) ** 2 +
        (point[1] - viewState.latitude) ** 2
      if (d < distance) {
        distance = d
        closest = point
      }
    }
    for (const vehicle of vehiclePositions) consider(vehicle.position)
    if (!closest && workerFrame)
      for (let i = 0; i < workerFrame.count; i++)
        consider([
          workerFrame.positions[i * 2]!,
          workerFrame.positions[i * 2 + 1]!,
        ])
    setViewState((current) => ({
      ...current,
      zoom: 19,
      ...(closest ? { longitude: closest[0], latitude: closest[1] } : {}),
    }))
  }

  return (
    <>
      <DeckGL
        onLoad={() => onReady?.()}
        initialViewState={{ ...initialViewState, maxZoom: 24 }}
        viewState={{ ...viewState, maxZoom: 24 }}
        controller
        layers={layers}
        onViewStateChange={({ viewState: vs }) => setViewState(vs as ViewState)}
        getTooltip={({ object, layer }) => {
          if (layer?.id === "vehicles-svg" && object)
            return `${object.vehicleKind}${object.linkId?.startsWith("sidewalk:") ? translateText(" · calçada virtual") : ""} · ${object.vehicleId}\n${object.speedKmh.toLocaleString(intlLocale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km/h${object.lane === undefined ? "" : Number.isInteger(object.lane) ? translateText(" · faixa {0}", { 0: object.lane + 1 }) : translateText(" · mudando de faixa")}`
          if (layer?.id === "stops-svg" && object)
            return `${object.kind} · ${object.label || object.stopId}`
          return null
        }}
        onHover={handleHover}
        onClick={handleClick}
        style={{
          position: "absolute",
          top: "0",
          left: "0",
          right: "0",
          bottom: "0",
        }}
      >
        <MapGL mapStyle={mapStyle} reuseMaps attributionControl={false}>
          <AttributionControl
            compact={false}
            position="top-left"
            style={{ marginTop: 64, marginLeft: 12 }}
          />
        </MapGL>
      </DeckGL>
      <div
        style={{
          position: "absolute",
          left: 12,
          top: 100,
          padding: "4px 8px",
          background: "rgba(20,20,24,.8)",
          color: "white",
          fontSize: 11,
        }}
      >
        {links.roadNetwork ? translateText("Rede OSM · clique numa via simulada") : translateText("Rede da simulação")}
      </div>
      <button
        type="button"
        onClick={focusVehicles}
        style={{
          position: "absolute",
          left: 12,
          top: 134,
          background: "rgba(20,20,24,.9)",
          color: "white",
          padding: "7px 10px",
          border: "1px solid #64748b",
          borderRadius: 6,
          cursor: "pointer",
        }}
      >{translateText("Ver veículos e faixas")}</button>
      <label style={{ position: "absolute", left: 12, top: 178, background: "rgba(20,20,24,.9)", color: "white", padding: "7px 10px", borderRadius: 6, fontSize: 12 }}>
        {translateText("Fundo do mapa")}{" "}
        <select value={background} onChange={(event) => {
          const value = event.target.value as "auto" | "osm" | "none"
          setBackground(value)
          const params = new URLSearchParams(window.location.search)
          if (value === "auto") params.delete("background")
          else params.set("background", value)
          window.history.replaceState(null, "", `?${params}`)
        }}>
          <option value="auto">{translateText("Automático")}</option>
          <option value="osm">OpenStreetMap</option>
          <option value="none">{translateText("Sem mapa de fundo")}</option>
        </select>
      </label>
      {hover?.kind === "link" && (
        <LinkTooltip x={hover.x} y={hover.y} link={hover.link} />
      )}
      {hover?.kind === "node" && (
        <NodeTooltip x={hover.x} y={hover.y} node={hover.node} />
      )}
      {selected?.kind === "link" && (
        <LinkPanel
          link={selected.link}
          relatedLinks={relatedLinks}
          onSelectLink={(link) => setSelected({ kind: "link", link })}
          onClose={() => setSelected(null)}
        />
      )}
      {selected?.kind === "node" && (
        <NodePanel
          node={selected.node}
          signal={signalByNodeId.get(selected.node.nodeId) ?? null}
          currentTick={currentTick}
          onClose={() => setSelected(null)}
        />
      )}
      {selected?.kind === "stop" && (
        <StopPanel stop={selected.stop} status={transit?.stopAt(selected.stop.stopId, currentTick)}
          connection={transitConnection} currentTick={currentTick} onClose={() => setSelected(null)} />
      )}
    </>
  )
}
