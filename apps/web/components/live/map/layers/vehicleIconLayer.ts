import { IconLayer } from "@deck.gl/layers";
import type { VehiclePosition } from "./vehicleScatterLayer";
import { speedColor } from "../speedColor";

type Shape = "circle" | "square" | "triangle" | "diamond" | "cross" | "star";

const KIND_SHAPE: Record<string, Shape> = {
  Car: "circle",
  Bus: "square",
  Subway: "triangle",
  Motorcycle: "diamond",
  Bicycle: "cross",
  Person: "star",
  Unknown: "circle"
};

const ICON_SIZE = 32;

/** Draws a solid white shape on a transparent canvas and returns a data URL. White so
 * IconLayer's `mask: true` can tint it per-datum via `getColor` (speed bucket color).
 */
export function buildShapeIconDataUrl(shape: Shape): string {
  const canvas = document.createElement("canvas");
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "white";
  const c = ICON_SIZE / 2;
  const r = ICON_SIZE * 0.4;

  switch (shape) {
    case "circle":
      ctx.beginPath();
      ctx.arc(c, c, r, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "square":
      ctx.fillRect(c - r, c - r, r * 2, r * 2);
      break;
    case "triangle":
      ctx.beginPath();
      ctx.moveTo(c, c - r);
      ctx.lineTo(c + r, c + r);
      ctx.lineTo(c - r, c + r);
      ctx.closePath();
      ctx.fill();
      break;
    case "diamond":
      ctx.beginPath();
      ctx.moveTo(c, c - r);
      ctx.lineTo(c + r, c);
      ctx.lineTo(c, c + r);
      ctx.lineTo(c - r, c);
      ctx.closePath();
      ctx.fill();
      break;
    case "cross": {
      const arm = r * 0.42;
      ctx.fillRect(c - arm, c - r, arm * 2, r * 2);
      ctx.fillRect(c - r, c - arm, r * 2, arm * 2);
      break;
    }
    case "star": {
      const spikes = 5;
      const outerR = r;
      const innerR = r * 0.45;
      ctx.beginPath();
      for (let i = 0; i < spikes * 2; i++) {
        const radius = i % 2 === 0 ? outerR : innerR;
        const angle = (Math.PI / spikes) * i - Math.PI / 2;
        const x = c + Math.cos(angle) * radius;
        const y = c + Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
  }
  return canvas.toDataURL();
}

const SHAPE_ICON_URLS: Record<Shape, string> = {
  circle: buildShapeIconDataUrl("circle"),
  square: buildShapeIconDataUrl("square"),
  triangle: buildShapeIconDataUrl("triangle"),
  diamond: buildShapeIconDataUrl("diamond"),
  cross: buildShapeIconDataUrl("cross"),
  star: buildShapeIconDataUrl("star")
};

/** Vehicle kind is a distinct geometric shape (circle/square/triangle); the shape's fill
 * color is the speed bucket color, so shape and speed are both visible on one glyph.
 */
export function createVehicleIconLayer(positions: VehiclePosition[], color?: (d: VehiclePosition) => [number, number, number]): IconLayer<VehiclePosition> {
  return new IconLayer<VehiclePosition>({
    id: "vehicles-icon",
    data: positions,
    getPosition: (d) => d.position,
    getIcon: (d) => {
      const shape = KIND_SHAPE[d.vehicleKind] ?? KIND_SHAPE.Unknown!;
      return {
        url: SHAPE_ICON_URLS[shape],
        width: ICON_SIZE,
        height: ICON_SIZE,
        mask: true
      };
    },
    getSize: 16,
    sizeUnits: "pixels",
    getColor: (d) => color ? color(d) : speedColor(d.speedKmh, d.freeSpeedKmh),
    updateTriggers: {
      getPosition: positions,
      getColor: [positions, color]
    }
  });
}
