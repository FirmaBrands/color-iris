import type { CMYK, RGB } from "../types";

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function hexToRgb(hex: string): RGB {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return { r: 0, g: 0, b: 0 };
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const to2 = (v: number) =>
    clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

export function cmykEquals(a: CMYK, b: CMYK): boolean {
  return a.c === b.c && a.m === b.m && a.y === b.y && a.k === b.k;
}

/** Total area coverage (sum of ink percentages). */
export function tac(cmyk: CMYK): number {
  return cmyk.c + cmyk.m + cmyk.y + cmyk.k;
}

/** Typical coated-stock ink limit; above this, drying/set-off problems. */
export const TAC_LIMIT = 300;

// ---------------------------------------------------------------------------
// RGB → CMYK separation algorithms
// ---------------------------------------------------------------------------

export interface SeparationAlgorithm {
  id: string;
  name: string;
  /** Black-generation bias applied to the naive K, in 0..1 ink units. */
  kBias: number;
}

export const SEPARATION_ALGORITHMS: SeparationAlgorithm[] = [
  { id: "swop", name: "Standard SWOP", kBias: 0 },
  { id: "ucr", name: "Low Black UCR", kBias: -0.1 },
  { id: "gcr", name: "Max Black GCR", kBias: +0.1 },
];

/**
 * Separates an RGB color into CMYK using naive complement separation with a
 * black-generation bias (negative = under-color removal favoring CMY,
 * positive = gray-component replacement favoring K).
 */
export function separate(rgb: RGB, kBias = 0): CMYK {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;

  const kNaive = 1 - Math.max(r, g, b);
  const k = clamp(kNaive + kBias, 0, 1);
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 };

  const c = clamp((1 - r - k) / (1 - k), 0, 1);
  const m = clamp((1 - g - k) / (1 - k), 0, 1);
  const y = clamp((1 - b - k) / (1 - k), 0, 1);

  return {
    c: Math.round(c * 100),
    m: Math.round(m * 100),
    y: Math.round(y * 100),
    k: Math.round(k * 100),
  };
}

/** Standard separation (no bias) — the default for direct conversions. */
export function rgbToCmyk(rgb: RGB): CMYK {
  return separate(rgb, 0);
}
