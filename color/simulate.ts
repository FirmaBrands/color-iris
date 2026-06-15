/**
 * On-screen simulation of how CMYK ink builds will look on coated stock.
 *
 * This is intentionally a *simulation*, not a colorimetric conversion: real
 * process inks are not spectrally pure, paper is not perfect white, and
 * halftone dots gain in the midtones. Modeling those three effects gets the
 * screen meaningfully closer to print than the naive `255 * (1-c) * (1-k)`
 * formula.
 */
import type { CMYK, Coloring, Paint, RGB, Stop } from "../types";
import { DEFAULT_WASH_ANGLE } from "../types";
import { clamp, rgbToHex } from "./convert";

/** Measured-ish solid ink RGB appearance on coated stock (SWOP-like). */
const INK = {
  c: { r: 0, g: 158, b: 224 },
  m: { r: 230, g: 0, b: 126 },
  y: { r: 255, g: 237, b: 0 },
  k: { r: 35, g: 31, b: 32 },
};

/** Coated paper is very slightly warm, never #FFFFFF. */
const PAPER: RGB = { r: 252, g: 252, b: 250 };

/** Mid-tone dot gain (tone value increase) for a 150 lpi coated print. */
const DOT_GAIN = 0.14;

/** Applies dot gain: ink coverage prints heavier in the midtones. */
function gain(v: number): number {
  // Peak increase at 50% coverage, none at 0% and 100%.
  return clamp(v + DOT_GAIN * 4 * v * (1 - v) * 0.5, 0, 1);
}

/** Multiplies the working color by one ink layer at `coverage`. */
function applyInk(base: RGB, ink: RGB, coverage: number): RGB {
  const t = gain(coverage);
  return {
    r: (base.r * (255 - (255 - ink.r) * t)) / 255,
    g: (base.g * (255 - (255 - ink.g) * t)) / 255,
    b: (base.b * (255 - (255 - ink.b) * t)) / 255,
  };
}

/** CMYK (0–100 per channel) → simulated on-paper RGB. */
export function simulateCmyk(cmyk: CMYK): RGB {
  let color: RGB = { ...PAPER };
  color = applyInk(color, INK.c, cmyk.c / 100);
  color = applyInk(color, INK.m, cmyk.m / 100);
  color = applyInk(color, INK.y, cmyk.y / 100);
  color = applyInk(color, INK.k, cmyk.k / 100);
  return {
    r: clamp(Math.round(color.r), 0, 255),
    g: clamp(Math.round(color.g), 0, 255),
    b: clamp(Math.round(color.b), 0, 255),
  };
}

export function cmykToHex(cmyk: CMYK): string {
  return rgbToHex(simulateCmyk(cmyk));
}

/** CSS gradient stop list with precise offsets, e.g. "#aabbcc 0%, #001122 35%". */
export function stopsToCss(stops: Stop[]): string {
  return stops
    .map((s) => `${cmykToHex(s.cmyk)} ${Math.round(s.offset * 1000) / 10}%`)
    .join(", ");
}

/** CSS background for any paint (used by swatches and flat cell backgrounds). */
export function paintToCss(paint: Paint): string {
  switch (paint.kind) {
    case "solid":
      return cmykToHex(paint.cmyk);
    case "linear":
      return `linear-gradient(${paint.angle ?? DEFAULT_WASH_ANGLE}deg, ${stopsToCss(paint.stops)})`;
    case "radial":
      return `radial-gradient(circle at 50% 50%, ${stopsToCss(paint.stops)})`;
  }
}

/**
 * CSS background for a whole coloring: wash paints as-is; multiple flat
 * slots render as hard-edged stripes (side-by-side comparison); a single
 * slot renders flat.
 */
export function coloringToCss(coloring: Coloring): string {
  if (coloring.wash) return paintToCss(coloring.wash);
  const slots = coloring.slots;
  if (slots.length <= 1) {
    return cmykToHex(slots[0] ?? { c: 0, m: 0, y: 0, k: 0 });
  }
  const stripes = slots
    .map((c, i) => {
      const hex = cmykToHex(c);
      const from = (i / slots.length) * 100;
      const to = ((i + 1) / slots.length) * 100;
      return `${hex} ${from}%, ${hex} ${to}%`;
    })
    .join(", ");
  return `linear-gradient(to right, ${stripes})`;
}
