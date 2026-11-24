/**
 * The traits that make up a character: its shape and its color. This module has no React, so the
 * contracts and the server can import the names without the renderer.
 */

/** One round lobe of a shape: center x, center y and radius in a 100 by 100 box. */
export type Lobe = readonly [cx: number, cy: number, r: number];

/** The lobes of a shape and where its eyes sit. The first lobe is the body. */
export interface ShapeGeometry {
  readonly lobes: ReadonlyArray<Lobe>;
  /** The center point between the two eyes and the distance between them. */
  readonly eyes: readonly [x: number, y: number, gap: number];
}

/** The shapes that a character can have, in the order that a picker shows them. */
export const CHARACTER_SHAPES = [
  "drop", "bean", "twin", "stack", "trio", "lump", "worm", "bud", "dollop", "tumble", "grape", "puddle",
] as const;
export type CharacterShape = (typeof CHARACTER_SHAPES)[number];

/** The highest lobe count of any shape. Each shape pads to it, so every shape can morph into every other one. */
export const MAX_LOBES = 5;

/** Clumps of lobes that melt together. Each lobe stays inside the box with room for a selection ring. */
export const SHAPE_GEOMETRY: Record<CharacterShape, ShapeGeometry> = {
  drop: { lobes: [[50, 52, 36]], eyes: [50, 48, 12] },
  bean: { lobes: [[42, 55, 29], [66, 45, 23]], eyes: [50, 48, 12] },
  twin: { lobes: [[36, 52, 25], [64, 52, 25]], eyes: [50, 49, 13] },
  stack: { lobes: [[50, 63, 27], [50, 34, 20]], eyes: [50, 34, 10] },
  trio: { lobes: [[50, 33, 22], [33, 61, 23], [67, 61, 23]], eyes: [50, 50, 12] },
  lump: { lobes: [[46, 55, 32], [78, 28, 10]], eyes: [44, 52, 12] },
  worm: { lobes: [[67, 46, 23], [44, 55, 18], [24, 62, 13]], eyes: [69, 43, 11] },
  bud: { lobes: [[50, 50, 25], [50, 23, 13], [77, 50, 13], [50, 77, 13], [23, 50, 13]], eyes: [50, 49, 11] },
  dollop: { lobes: [[50, 64, 26], [50, 42, 19], [55, 22, 9]], eyes: [50, 60, 12] },
  tumble: { lobes: [[45, 56, 28], [71, 39, 16], [70, 71, 13], [25, 32, 11]], eyes: [46, 54, 12] },
  grape: { lobes: [[52, 62, 19], [36, 40, 17], [63, 37, 17], [31, 65, 15], [74, 60, 13]], eyes: [50, 52, 12] },
  puddle: { lobes: [[50, 58, 23], [29, 63, 17], [72, 63, 17]], eyes: [50, 54, 12] },
};

/** The longest side that fitted art may take, in box units. It keeps a little room for the hop and the droplet. */
const FIT_LONGEST = 94;

/**
 * The visual size that fitted art aims for: the square root of its bounding area, in box units. A
 * flat shape then grows more than a round one, so all shapes look equally heavy in a list.
 */
const FIT_AREA = 78;

/** Places a shape in its box: the point that goes to the box center, the scale, and the fitted bottom edge. */
export interface ShapeFit {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  /** The lowest point of the art after the fit. The squash and the hop pivot on it. */
  readonly bottom: number;
}

/** Leaves the art as drawn, with room for the selection ring. */
export const NO_FIT: ShapeFit = { x: 50, y: 50, scale: 1, bottom: 88 };

/** Works out how to center and scale a shape so that it fills its box with the same visual weight as the others. */
export function shapeFit(shape: CharacterShape): ShapeFit {
  const { lobes } = SHAPE_GEOMETRY[shape];
  const left = Math.min(...lobes.map(([x, , r]) => x - r));
  const right = Math.max(...lobes.map(([x, , r]) => x + r));
  const top = Math.min(...lobes.map(([, y, r]) => y - r));
  const bottom = Math.max(...lobes.map(([, y, r]) => y + r));
  const width = right - left;
  const height = bottom - top;
  const scale = Math.min(FIT_LONGEST / Math.max(width, height), FIT_AREA / Math.sqrt(width * height));

  return { x: (left + right) / 2, y: (top + bottom) / 2, scale, bottom: 50 + (height / 2) * scale };
}

/** The colors that a character can have, in the order that a picker shows them. */
export const CHARACTER_COLORS = [
  "brown", "red", "orange", "amber", "green", "teal", "blue", "purple", "pink", "gray",
] as const;
export type CharacterColor = (typeof CHARACTER_COLORS)[number];

export const COLOR_HEX: Record<CharacterColor, string> = {
  brown: "#8b6240",
  red: "#ef4444",
  orange: "#f07a2b",
  amber: "#f5a524",
  green: "#4cc96d",
  teal: "#45b8a5",
  blue: "#3b82f6",
  purple: "#8b5cf6",
  pink: "#ec4899",
  gray: "#737373",
};
