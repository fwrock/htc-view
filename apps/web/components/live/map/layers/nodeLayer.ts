import { ScatterplotLayer } from "@deck.gl/layers";
import type { NodesTable } from "../../types/replay";

export interface NodeInfo {
  nodeId: string;
  position: [number, number];
  hasSignal: boolean;
}

export function nodeInfoAt(nodes: NodesTable, index: number): NodeInfo {
  return {
    nodeId: nodes.nodeId[index]!,
    position: [nodes.lon[index]!, nodes.lat[index]!],
    hasSignal: nodes.hasSignal[index] !== 0
  };
}

const PLAIN_COLOR: [number, number, number, number] = [90, 90, 100, 140];
const SIGNAL_COLOR: [number, number, number, number] = [255, 149, 0, 230];
const SELECTED_COLOR: [number, number, number, number] = [255, 236, 61, 255];

export interface NodePositionBuffer {
  positions: Float32Array;
}

/** Positions never change after `nodes` loads — same binary-attributes approach as the link
 * layer, for the same reason: a plain per-node JS object + accessor functions is exactly what
 * made the 718k-link scenario stall for ~38s before that layer was made binary too (see
 * docs/ARCHITECTURE.md). Scenario node counts are the same order of magnitude as link counts.
 */
export function buildNodePositionBuffer(nodes: NodesTable): NodePositionBuffer {
  const n = nodes.length;
  const positions = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    positions[i * 2] = nodes.lon[i]!;
    positions[i * 2 + 1] = nodes.lat[i]!;
  }
  return { positions };
}

function buildNodeColorBuffer(nodes: NodesTable, selectedNodeId: string | null): Uint8Array {
  const n = nodes.length;
  const colors = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const c =
      nodes.nodeId[i] === selectedNodeId ? SELECTED_COLOR : nodes.hasSignal[i] !== 0 ? SIGNAL_COLOR : PLAIN_COLOR;
    colors[i * 4] = c[0];
    colors[i * 4 + 1] = c[1];
    colors[i * 4 + 2] = c[2];
    colors[i * 4 + 3] = c[3];
  }
  return colors;
}

function buildNodeRadiusBuffer(nodes: NodesTable, selectedNodeId: string | null): Float32Array {
  const n = nodes.length;
  const radii = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    radii[i] = nodes.nodeId[i] === selectedNodeId ? 1.2 : nodes.hasSignal[i] !== 0 ? 0.8 : 0.5;
  }
  return radii;
}

/** Traffic-signal nodes render larger and orange, distinct from plain intersections, before
 * the user even clicks — clicking either kind picks it (see `nodeInfoAt`); only signal nodes
 * carry phase information in the resulting panel (map/trafficSignal.ts).
 */
export function createNodeLayerBinary(
  nodes: NodesTable,
  positionBuffer: NodePositionBuffer,
  selectedNodeId: string | null
): ScatterplotLayer {
  const colors = buildNodeColorBuffer(nodes, selectedNodeId);
  const radii = buildNodeRadiusBuffer(nodes, selectedNodeId);
  return new ScatterplotLayer({
    id: "nodes",
    data: {
      length: nodes.length,
      attributes: {
        getPosition: { value: positionBuffer.positions, size: 2 },
        getFillColor: { value: colors, size: 4 },
        getRadius: { value: radii, size: 1 }
      }
    },
    radiusUnits: "meters",
    pickable: true,
    updateTriggers: {
      getFillColor: selectedNodeId,
      getRadius: selectedNodeId
    }
  });
}
