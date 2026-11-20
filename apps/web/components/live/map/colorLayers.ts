import type { PathLayer } from "@deck.gl/layers"
import type { Layer } from "@deck.gl/core"

// Preserve binary position/width buffers while replacing just the color attribute.
export function tintBinaryLayer(layer: Layer, colors: Uint8Array, attribute: string): Layer {
  if (Array.isArray(layer.props.data)) {
    return (layer as PathLayer).clone({
      getColor: (_item, { index }) => [colors[index * 3]!, colors[index * 3 + 1]!, colors[index * 3 + 2]!],
      updateTriggers: { ...layer.props.updateTriggers, getColor: colors },
    })
  }
  const data = layer.props.data as { length: number; attributes: Record<string, unknown> }
  return layer.clone({ data: { ...data, attributes: { ...data.attributes, [attribute]: { value: colors, size: 3 } } } })
}
export function colorBuffer(ids: string[], color: (id: string) => [number, number, number], selected?: string): Uint8Array {
  const result = new Uint8Array(ids.length * 3)
  ids.forEach((id, i) => result.set(id === selected ? [255,202,40] : color(id), i*3))
  return result
}
